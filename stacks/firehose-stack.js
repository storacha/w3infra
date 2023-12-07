import { Bucket, use } from '@serverless-stack/resources'
import {
  Aws,
  Duration,
  aws_iam as iam,
  aws_logs as logs,
  aws_kinesisfirehose as firehose,
  aws_glue as glue,
  aws_athena as athena,
  aws_sam as sam
} from 'aws-cdk-lib'

import { UcanInvocationStack } from './ucan-invocation-stack.js'

import {
  getBucketConfig,
  getCdkNames,
  setupSentry
} from './config.js'

/**
 * @param {import('@serverless-stack/resources').StackContext} properties
 */
export function UcanFirehoseStack ({ stack, app }) {
  stack.setDefaultFunctionProps({
    srcPath: 'ucan-firehose'
  })

  // Setup app monitoring with Sentry
  setupSentry(app, stack)

  // Get dependent stack references
  const { ucanStream } = use(UcanInvocationStack)

  // Stream log bucket for metrics
  const streamLogBucket = new Bucket(stack, 'stream-log-store', {
    cors: true,
    cdk: {
      bucket: {
        ...getBucketConfig('stream-log-store', app.stage),
        lifecycleRules: [{
          enabled: true,
          expiration: Duration.days(90)
        }]
      }
    }
  })

  // Roles for delivery stream
  const deliveryStreamRoleName = getCdkNames('ucan-stream-delivery-role', app.stage)
  const deliveryStreamRole = new iam.Role(stack, deliveryStreamRoleName, {
    assumedBy: new iam.ServicePrincipal('firehose.amazonaws.com'),
    roleName: deliveryStreamRoleName
  })

  const logGroupName = getCdkNames('ucan-stream-delivery-error-logging', app.stage)
  const cfnLogGroup = new logs.CfnLogGroup(stack, logGroupName, {
    retentionInDays: 90,
    logGroupName
  })

  // Assign permissions
  ucanStream.cdk.stream.grantRead(deliveryStreamRole)
  const policyName = getCdkNames('ucan-stream-delivery-policy', app.stage)
  new iam.Policy(stack, policyName, {
    policyName,
    roles: [deliveryStreamRole],
    statements: [
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        resources: [ucanStream.streamArn],
        actions: [
          'kinesis:DescribeStream',
          'kinesis:GetShardIterator',
          'kinesis:GetRecords',
        ],
      }),
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        resources: [
          streamLogBucket.bucketArn,
          `${streamLogBucket.bucketArn}/*`
        ],
        actions: [
          's3:AbortMultipartUpload',
          's3:GetBucketLocation',
          's3:GetObject',
          's3:ListBucket',
          's3:ListBucketMultipartUploads',
          's3:PutObject',
          's3:PutObjectAcl',
        ],
      }),
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        resources: [cfnLogGroup.attrArn],
        actions: [
          'logs:PutLogEvents'
        ],
      }),
    ],
  })

  // Create AWS Kinesis Firehose
  const deliveryStreamName = getCdkNames('ucan-stream-delivery', app.stage)
  const deliveryFirehose = new firehose.CfnDeliveryStream(stack, deliveryStreamName, {
    deliveryStreamName,
    deliveryStreamType: 'KinesisStreamAsSource',
    kinesisStreamSourceConfiguration: {
      kinesisStreamArn: ucanStream.streamArn,
      roleArn: deliveryStreamRole.roleArn
    },
    extendedS3DestinationConfiguration: {
      bucketArn: streamLogBucket.bucketArn,
      roleArn: deliveryStreamRole.roleArn,
      bufferingHints: {
        intervalInSeconds: 60
      },
      // makes easier to run high performance, cost efficient analytics with Athena
      dynamicPartitioningConfiguration: {
        enabled: true
      },
      processingConfiguration: {
        enabled: true,
        processors: [
          {
            type: 'MetadataExtraction',
            parameters: [
              {
                parameterName: 'MetadataExtractionQuery',
                // extract yyyy-MM-dd formatted current date from millisecond epoch timestamp "ts" using jq syntax
                // extract type ('workflow' or 'receipt')
                // extract the UCAN ability of the invocation to a key named "op" - this matches the latest UCAN spec https://github.com/ucan-wg/invocation/pull/21/files#diff-b335630551682c19a781afebcf4d07bf978fb1f8ac04c6bf87428ed5106870f5R208
                //   we replace / with _ here since it will be used in the S3 bucket path and we a) don't want it to collide with the path separator and b) want it to be easy to refer to in queries
                // eslint-disable-next-line no-useless-escape
                parameterValue: '{day: (.ts/1000) | strftime("%Y-%m-%d"), type: .type, op: (.value.att[0].can | gsub("\/"; "_"))}',
              },
              {
                parameterName: 'JsonParsingEngine',
                parameterValue: 'JQ-1.6',
              }
            ]
          },
          {
            type: 'AppendDelimiterToRecord',
            parameters: [
              {
                parameterName: 'Delimiter',
                parameterValue: '\\n',
              },
            ],
          },
        ],
      },
      // See https://docs.aws.amazon.com/athena/latest/ug/partition-projection-kinesis-firehose-example.html for general information on partitioning.
      // Daily partitions seem right (https://www.upsolver.com/blog/partitioning-data-s3-improve-performance-athena-presto)
      // "A rough rule of thumb is that each 100 partitions scanned adds about 1 second of latency to your query in Amazon Athena. This is why minutely or hourly
      // partitions are rarely used – typically you would choose between daily, weekly, and monthly partitions, depending on the nature of your queries."
      // We also partition by "type" (workflow or receipt) and "op" (the invoked UCAN ability name):
      //  1) Receipts generally have all the information workflows have so we can safely ignore workflows. 
      //  2) Partitioning by "op" lets us ignore large classes of operations that we don't care about and should
      //     make queries significantly more efficient.
      prefix: 'logs/!{partitionKeyFromQuery:type}/!{partitionKeyFromQuery:op}/!{partitionKeyFromQuery:day}/',
      errorOutputPrefix: 'error'
    }
  })

  deliveryFirehose.node.addDependency(deliveryStreamRole)

  // Glue database
  const databaseName = getCdkNames('ucan-stream-delivery-database', app.stage)
  const glueDatabase = new glue.CfnDatabase(stack, databaseName, {
    catalogId: Aws.ACCOUNT_ID,
    databaseInput: {
      name: databaseName,
    }
  })

  // creates a table that can be seen in the AWS Glue table browser at 
  // https://console.aws.amazon.com/glue/home#/v2/data-catalog/tables
  // and in the data browser in the Athena Query editor at
  // https://console.aws.amazon.com/athena/home#/query-editor
  const receiptTableName = getCdkNames('ucan-receipt-table', app.stage)
  const receiptTable = new glue.CfnTable(stack, receiptTableName, {
    catalogId: Aws.ACCOUNT_ID,
    databaseName,
    tableInput: {
      name: receiptTableName,
      partitionKeys: [
        { name: 'day', type: 'date' },
        { name: 'op', type: 'string' }
      ],
      parameters: {
        classification: "json",
        typeOfData: "file",
        // @see https://docs.aws.amazon.com/athena/latest/ug/partition-projection-kinesis-firehose-example.html for more information on projection
        // configuration - this should match the "day" parameter and S3 prefix configured in the delivery stream
        "projection.enabled": "true",
        "projection.day.type": "date",
        "projection.day.format": "yyyy-MM-dd",
        "projection.day.range": "2023-01-01,NOW",
        "projection.day.interval": "1",
        "projection.day.interval.unit": "DAYS",
        "projection.op.type": "enum",
        "projection.op.values": 'access_authorize,access_claim,access_delegate,access_session,admin_store_inspect,admin_upload_inspect,aggregate_accept,aggregate_offer,deal_info,consumer_get,consumer_has,customer_get,filecoin_accept,filecoin_info,filecoin_offer,filecoin_submit,piece_accept,piece_offer,provider_add,rate-limit_add,rate-limit_list,rate-limit_remove,space_info,store_add,store_remove,subscription_get,ucan_revoke,upload_add,upload_list,upload_remove',
        "storage.location.template": `s3://${streamLogBucket.bucketName}/logs/receipt/\${op}/\${day}/`
      },
      storageDescriptor: {
        location: `s3://${streamLogBucket.bucketName}/logs/receipt/`,
        columns: [
          { name: 'carcid', type: 'string' },
          // STRUCT here refers to the Apache Hive STRUCT datatype - see https://aws.amazon.com/blogs/big-data/create-tables-in-amazon-athena-from-nested-json-and-mappings-using-jsonserde/
          { name: 'value', type: 'STRUCT<att:ARRAY<struct<can:STRING,with:STRING,nb:STRING>>,iss:STRING,aud:STRING>' },
          { name: "out", type: "STRUCT<error:STRUCT<name:STRING,message:STRING>,ok:STRING>" },
          { name: "ts", type: "timestamp" }
        ],
        inputFormat: 'org.apache.hadoop.mapred.TextInputFormat',
        outputFormat: 'org.apache.hadoop.hive.ql.io.HiveIgnoreKeyTextOutputFormat',
        serdeInfo: {
          serializationLibrary: 'org.openx.data.jsonserde.JsonSerDe',
          parameters: {
            // see https://aws.amazon.com/blogs/big-data/create-tables-in-amazon-athena-from-nested-json-and-mappings-using-jsonserde/
            'mapping._cid_slash': '/'
          }
        }
      }
    }
  })
  receiptTable.addDependsOn(glueDatabase)

  // creates a table that can be seen in the AWS Glue table browser at 
  // https://console.aws.amazon.com/glue/home#/v2/data-catalog/tables
  // and in the data browser in the Athena Query editor at
  // https://console.aws.amazon.com/athena/home#/query-editor
  const storeAddTableName = getCdkNames('store-add-table', app.stage)
  const storeAddTable = new glue.CfnTable(stack, storeAddTableName, {
    catalogId: Aws.ACCOUNT_ID,
    databaseName,
    tableInput: {
      name: storeAddTableName,
      partitionKeys: [
        { name: 'day', type: 'date' }
      ],
      parameters: {
        classification: "json",
        typeOfData: "file",
        // @see https://docs.aws.amazon.com/athena/latest/ug/partition-projection-kinesis-firehose-example.html for more information on projection
        // configuration - this should match the "day" parameter and S3 prefix configured in the delivery stream
        "projection.enabled": "true",
        "projection.day.type": "date",
        "projection.day.format": "yyyy-MM-dd",
        "projection.day.range": "2023-01-01,NOW",
        "projection.day.interval": "1",
        "projection.day.interval.unit": "DAYS",
        "storage.location.template": `s3://${streamLogBucket.bucketName}/logs/receipt/store_add/\${day}/`
      },
      storageDescriptor: {
        location: `s3://${streamLogBucket.bucketName}/logs/receipt/store_add/`,
        columns: [
          { name: 'carcid', type: 'string' },
          // STRUCT here refers to the Apache Hive STRUCT datatype - see https://aws.amazon.com/blogs/big-data/create-tables-in-amazon-athena-from-nested-json-and-mappings-using-jsonserde/
          { name: 'value', type: 'STRUCT<att:ARRAY<struct<can:STRING,with:STRING,nb:STRUCT<size:BIGINT,link:STRUCT<_cid_slash:STRING>>>>,iss:STRING,aud:STRING>' },
          { name: "out", type: "STRUCT<error:STRUCT<name:STRING>,ok:STRUCT<status:STRING,link:STRUCT<_cid_slash:STRING>>>" },
          { name: "ts", type: "timestamp" }
        ],
        inputFormat: 'org.apache.hadoop.mapred.TextInputFormat',
        outputFormat: 'org.apache.hadoop.hive.ql.io.HiveIgnoreKeyTextOutputFormat',
        serdeInfo: {
          serializationLibrary: 'org.openx.data.jsonserde.JsonSerDe',
          parameters: {
            // see https://aws.amazon.com/blogs/big-data/create-tables-in-amazon-athena-from-nested-json-and-mappings-using-jsonserde/
            'mapping._cid_slash': '/'
          }
        }
      }
    }
  })
  storeAddTable.addDependsOn(glueDatabase)

  // creates a table that can be seen in the AWS Glue table browser at 
  // https://console.aws.amazon.com/glue/home#/v2/data-catalog/tables
  // and in the data browser in the Athena Query editor at
  // https://console.aws.amazon.com/athena/home#/query-editor
  const uploadAddTableName = getCdkNames('upload-add-table', app.stage)
  const uploadAddTable = new glue.CfnTable(stack, uploadAddTableName, {
    catalogId: Aws.ACCOUNT_ID,
    databaseName,
    tableInput: {
      name: uploadAddTableName,
      partitionKeys: [
        { name: 'day', type: 'date' }
      ],
      parameters: {
        classification: "json",
        typeOfData: "file",
        // @see https://docs.aws.amazon.com/athena/latest/ug/partition-projection-kinesis-firehose-example.html for more information on projection
        // configuration - this should match the "day" parameter and S3 prefix configured in the delivery stream
        "projection.enabled": "true",
        "projection.day.type": "date",
        "projection.day.format": "yyyy-MM-dd",
        "projection.day.range": "2023-01-01,NOW",
        "projection.day.interval": "1",
        "projection.day.interval.unit": "DAYS",
        "storage.location.template": `s3://${streamLogBucket.bucketName}/logs/receipt/upload_add/\${day}/`
      },
      storageDescriptor: {
        location: `s3://${streamLogBucket.bucketName}/logs/receipt/upload_add/`,
        columns: [
          { name: 'carcid', type: 'string' },
          // STRUCT here refers to the Apache Hive STRUCT datatype - see https://aws.amazon.com/blogs/big-data/create-tables-in-amazon-athena-from-nested-json-and-mappings-using-jsonserde/
          { name: 'value', type: 'STRUCT<att:ARRAY<STRUCT<can:STRING,with:STRING,nb:STRUCT<root:STRUCT<_cid_slash:STRING>,shards:ARRAY<STRUCT<_cid_slash:STRING>>>>>,iss:STRING,aud:STRING>' },
          { name: "out", type: "STRUCT<error:STRUCT<name:STRING>,ok:STRUCT<root:STRUCT<_cid_slash:STRING>,shards:ARRAY<STRUCT<_cid_slash:STRING>>>>" },
          { name: "ts", type: "timestamp" }
        ],
        inputFormat: 'org.apache.hadoop.mapred.TextInputFormat',
        outputFormat: 'org.apache.hadoop.hive.ql.io.HiveIgnoreKeyTextOutputFormat',
        serdeInfo: {
          serializationLibrary: 'org.openx.data.jsonserde.JsonSerDe',
          parameters: {
            // see https://aws.amazon.com/blogs/big-data/create-tables-in-amazon-athena-from-nested-json-and-mappings-using-jsonserde/
            'mapping._cid_slash': '/'
          }
        }
      }
    }
  })
  uploadAddTable.addDependsOn(glueDatabase)

  // creates a table that can be seen in the AWS Glue table browser at 
  // https://console.aws.amazon.com/glue/home#/v2/data-catalog/tables
  // and in the data browser in the Athena Query editor at
  // https://console.aws.amazon.com/athena/home#/query-editor
  const storeRemoveTableName = getCdkNames('store-remove-table', app.stage)
  const storeRemoveTable = new glue.CfnTable(stack, storeRemoveTableName, {
    catalogId: Aws.ACCOUNT_ID,
    databaseName,
    tableInput: {
      name: storeRemoveTableName,
      partitionKeys: [
        { name: 'day', type: 'date' }
      ],
      parameters: {
        classification: "json",
        typeOfData: "file",
        // @see https://docs.aws.amazon.com/athena/latest/ug/partition-projection-kinesis-firehose-example.html for more information on projection
        // configuration - this should match the "day" parameter and S3 prefix configured in the delivery stream
        "projection.enabled": "true",
        "projection.day.type": "date",
        "projection.day.format": "yyyy-MM-dd",
        "projection.day.range": "2023-01-01,NOW",
        "projection.day.interval": "1",
        "projection.day.interval.unit": "DAYS",
        "storage.location.template": `s3://${streamLogBucket.bucketName}/logs/receipt/store_remove/\${day}/`
      },
      storageDescriptor: {
        location: `s3://${streamLogBucket.bucketName}/logs/receipt/store_remove/`,
        columns: [
          { name: 'carcid', type: 'string' },
          // STRUCT here refers to the Apache Hive STRUCT datatype - see https://aws.amazon.com/blogs/big-data/create-tables-in-amazon-athena-from-nested-json-and-mappings-using-jsonserde/
          { name: 'value', type: 'STRUCT<att:ARRAY<struct<can:STRING,with:STRING,nb:STRUCT<link:STRUCT<_cid_slash:STRING>>>>,iss:STRING,aud:STRING>' },
          { name: "out", type: "STRUCT<error:STRUCT<name:STRING>,ok:STRUCT<size:BIGINT>>" },
          { name: "ts", type: "timestamp" }
        ],
        inputFormat: 'org.apache.hadoop.mapred.TextInputFormat',
        outputFormat: 'org.apache.hadoop.hive.ql.io.HiveIgnoreKeyTextOutputFormat',
        serdeInfo: {
          serializationLibrary: 'org.openx.data.jsonserde.JsonSerDe',
          parameters: {
            // see https://aws.amazon.com/blogs/big-data/create-tables-in-amazon-athena-from-nested-json-and-mappings-using-jsonserde/
            'mapping._cid_slash': '/'
          }
        }
      }
    }
  })
  storeRemoveTable.addDependsOn(glueDatabase)

  // creates a table that can be seen in the AWS Glue table browser at 
  // https://console.aws.amazon.com/glue/home#/v2/data-catalog/tables
  // and in the data browser in the Athena Query editor at
  // https://console.aws.amazon.com/athena/home#/query-editor
  const uploadRemoveTableName = getCdkNames('upload-remove-table', app.stage)
  const uploadRemoveTable = new glue.CfnTable(stack, uploadRemoveTableName, {
    catalogId: Aws.ACCOUNT_ID,
    databaseName,
    tableInput: {
      name: uploadRemoveTableName,
      partitionKeys: [
        { name: 'day', type: 'date' }
      ],
      parameters: {
        classification: "json",
        typeOfData: "file",
        // @see https://docs.aws.amazon.com/athena/latest/ug/partition-projection-kinesis-firehose-example.html for more information on projection
        // configuration - this should match the "day" parameter and S3 prefix configured in the delivery stream
        "projection.enabled": "true",
        "projection.day.type": "date",
        "projection.day.format": "yyyy-MM-dd",
        "projection.day.range": "2023-01-01,NOW",
        "projection.day.interval": "1",
        "projection.day.interval.unit": "DAYS",
        "storage.location.template": `s3://${streamLogBucket.bucketName}/logs/receipt/upload_remove/\${day}/`
      },
      storageDescriptor: {
        location: `s3://${streamLogBucket.bucketName}/logs/receipt/upload_remove/`,
        columns: [
          { name: 'carcid', type: 'string' },
          // STRUCT here refers to the Apache Hive STRUCT datatype - see https://aws.amazon.com/blogs/big-data/create-tables-in-amazon-athena-from-nested-json-and-mappings-using-jsonserde/
          { name: 'value', type: 'STRUCT<att:ARRAY<STRUCT<can:STRING,with:STRING,nb:STRUCT<root:STRUCT<_cid_slash:STRING>,shards:ARRAY<STRUCT<_cid_slash:STRING>>>>>,iss:STRING,aud:STRING>' },
          { name: "out", type: "STRUCT<error:STRUCT<name:STRING>,ok:STRUCT<root:STRUCT<_cid_slash:STRING>,shards:ARRAY<STRUCT<_cid_slash:STRING>>>>" },
          { name: "ts", type: "timestamp" }
        ],
        inputFormat: 'org.apache.hadoop.mapred.TextInputFormat',
        outputFormat: 'org.apache.hadoop.hive.ql.io.HiveIgnoreKeyTextOutputFormat',
        serdeInfo: {
          serializationLibrary: 'org.openx.data.jsonserde.JsonSerDe',
          parameters: {
            // see https://aws.amazon.com/blogs/big-data/create-tables-in-amazon-athena-from-nested-json-and-mappings-using-jsonserde/
            'mapping._cid_slash': '/'
          }
        }
      }
    }
  })
  uploadRemoveTable.addDependsOn(glueDatabase)

  // creates a table that can be seen in the AWS Glue table browser at 
  // https://console.aws.amazon.com/glue/home#/v2/data-catalog/tables
  // and in the data browser in the Athena Query editor at
  // https://console.aws.amazon.com/athena/home#/query-editor
  const providerAddTableName = getCdkNames('provider-add-table', app.stage)
  const providerAddTable = new glue.CfnTable(stack, providerAddTableName, {
    catalogId: Aws.ACCOUNT_ID,
    databaseName,
    tableInput: {
      name: providerAddTableName,
      partitionKeys: [
        { name: 'day', type: 'date' }
      ],
      parameters: {
        classification: "json",
        typeOfData: "file",
        // @see https://docs.aws.amazon.com/athena/latest/ug/partition-projection-kinesis-firehose-example.html for more information on projection
        // configuration - this should match the "day" parameter and S3 prefix configured in the delivery stream
        "projection.enabled": "true",
        "projection.day.type": "date",
        "projection.day.format": "yyyy-MM-dd",
        "projection.day.range": "2023-01-01,NOW",
        "projection.day.interval": "1",
        "projection.day.interval.unit": "DAYS",
        "storage.location.template": `s3://${streamLogBucket.bucketName}/logs/receipt/provider_add/\${day}/`
      },
      storageDescriptor: {
        location: `s3://${streamLogBucket.bucketName}/logs/receipt/provider_add/`,
        columns: [
          { name: 'carcid', type: 'string' },
          // STRUCT here refers to the Apache Hive STRUCT datatype - see https://aws.amazon.com/blogs/big-data/create-tables-in-amazon-athena-from-nested-json-and-mappings-using-jsonserde/
          { name: 'value', type: 'STRUCT<att:ARRAY<struct<can:STRING,with:STRING,nb:STRUCT<provider:STRING,consumer:STRING>>>,iss:STRING,aud:STRING>' },
          { name: "out", type: "STRUCT<error:STRUCT<name:STRING>,ok:STRUCT<root:STRUCT<_cid_slash:STRING>>>" },
          { name: "ts", type: "timestamp" }
        ],
        inputFormat: 'org.apache.hadoop.mapred.TextInputFormat',
        outputFormat: 'org.apache.hadoop.hive.ql.io.HiveIgnoreKeyTextOutputFormat',
        serdeInfo: {
          serializationLibrary: 'org.openx.data.jsonserde.JsonSerDe',
          parameters: {
            // see https://aws.amazon.com/blogs/big-data/create-tables-in-amazon-athena-from-nested-json-and-mappings-using-jsonserde/
            'mapping._cid_slash': '/'
          }
        }
      }
    }
  })
  providerAddTable.addDependsOn(glueDatabase)

  // creates a table that can be seen in the AWS Glue table browser at 
  // https://console.aws.amazon.com/glue/home#/v2/data-catalog/tables
  // and in the data browser in the Athena Query editor at
  // https://console.aws.amazon.com/athena/home#/query-editor
  const aggregateOfferTableName = getCdkNames('aggregate-offer-table', app.stage)
  const aggregateOfferTable = new glue.CfnTable(stack, aggregateOfferTableName, {
    catalogId: Aws.ACCOUNT_ID,
    databaseName,
    tableInput: {
      name: aggregateOfferTableName,
      partitionKeys: [
        { name: 'day', type: 'date' }
      ],
      parameters: {
        classification: "json",
        typeOfData: "file",
        // @see https://docs.aws.amazon.com/athena/latest/ug/partition-projection-kinesis-firehose-example.html for more information on projection
        // configuration - this should match the "day" parameter and S3 prefix configured in the delivery stream
        "projection.enabled": "true",
        "projection.day.type": "date",
        "projection.day.format": "yyyy-MM-dd",
        "projection.day.range": "2023-01-01,NOW",
        "projection.day.interval": "1",
        "projection.day.interval.unit": "DAYS",
        "storage.location.template": `s3://${streamLogBucket.bucketName}/logs/receipt/aggregate_offer/\${day}/`
      },
      storageDescriptor: {
        location: `s3://${streamLogBucket.bucketName}/logs/receipt/aggregate_offer/`,
        columns: [
          { name: 'carcid', type: 'string' },
          // STRUCT here refers to the Apache Hive STRUCT datatype - see https://aws.amazon.com/blogs/big-data/create-tables-in-amazon-athena-from-nested-json-and-mappings-using-jsonserde/
          { name: 'value', type: 'STRUCT<att:ARRAY<struct<can:STRING,with:STRING,nb:STRUCT<aggregate:STRUCT<_cid_slash:STRING>>>>,iss:STRING,aud:STRING>' },
          { name: 'out', type: 'STRUCT<error:STRUCT<name:STRING>,ok:STRUCT<aggregate:STRUCT<_cid_slash:STRING>>>' },
          { name: 'ts', type: 'timestamp' }
        ],
        inputFormat: 'org.apache.hadoop.mapred.TextInputFormat',
        outputFormat: 'org.apache.hadoop.hive.ql.io.HiveIgnoreKeyTextOutputFormat',
        serdeInfo: {
          serializationLibrary: 'org.openx.data.jsonserde.JsonSerDe',
          parameters: {
            // see https://aws.amazon.com/blogs/big-data/create-tables-in-amazon-athena-from-nested-json-and-mappings-using-jsonserde/
            'mapping._cid_slash': '/'
          }
        }
      }
    }
  })
  aggregateOfferTable.addDependsOn(glueDatabase)

  // creates a table that can be seen in the AWS Glue table browser at 
  // https://console.aws.amazon.com/glue/home#/v2/data-catalog/tables
  // and in the data browser in the Athena Query editor at
  // https://console.aws.amazon.com/athena/home#/query-editor
  const aggregateAcceptTableName = getCdkNames('aggregate-accept-table', app.stage)
  const aggregateAcceptTable = new glue.CfnTable(stack, aggregateAcceptTableName, {
    catalogId: Aws.ACCOUNT_ID,
    databaseName,
    tableInput: {
      name: aggregateAcceptTableName,
      partitionKeys: [
        { name: 'day', type: 'date' }
      ],
      parameters: {
        classification: "json",
        typeOfData: "file",
        // @see https://docs.aws.amazon.com/athena/latest/ug/partition-projection-kinesis-firehose-example.html for more information on projection
        // configuration - this should match the "day" parameter and S3 prefix configured in the delivery stream
        "projection.enabled": "true",
        "projection.day.type": "date",
        "projection.day.format": "yyyy-MM-dd",
        "projection.day.range": "2023-01-01,NOW",
        "projection.day.interval": "1",
        "projection.day.interval.unit": "DAYS",
        "storage.location.template": `s3://${streamLogBucket.bucketName}/logs/receipt/aggregate_accept/\${day}/`
      },
      storageDescriptor: {
        location: `s3://${streamLogBucket.bucketName}/logs/receipt/aggregate_accept/`,
        columns: [
          { name: 'carcid', type: 'string' },
          // STRUCT here refers to the Apache Hive STRUCT datatype - see https://aws.amazon.com/blogs/big-data/create-tables-in-amazon-athena-from-nested-json-and-mappings-using-jsonserde/
          { name: 'value', type: 'STRUCT<att:ARRAY<struct<can:STRING,with:STRING,nb:STRUCT<aggregate:STRUCT<_cid_slash:STRING>>>>,iss:STRING,aud:STRING>' },
          { name: 'out', type: 'STRUCT<error:STRUCT<name:STRING>,ok:STRUCT<aggregate:STRUCT<_cid_slash:STRING>>>' },
          { name: 'ts', type: 'timestamp' }
        ],
        inputFormat: 'org.apache.hadoop.mapred.TextInputFormat',
        outputFormat: 'org.apache.hadoop.hive.ql.io.HiveIgnoreKeyTextOutputFormat',
        serdeInfo: {
          serializationLibrary: 'org.openx.data.jsonserde.JsonSerDe',
          parameters: {
            // see https://aws.amazon.com/blogs/big-data/create-tables-in-amazon-athena-from-nested-json-and-mappings-using-jsonserde/
            'mapping._cid_slash': '/'
          }
        }
      }
    }
  })
  aggregateAcceptTable.addDependsOn(glueDatabase)

  const athenaResultsBucket = new Bucket(stack, 'athena-w3up-results', {
    cors: true,
    cdk: {
      bucket: {
        ...getBucketConfig('athena-w3up-results', app.stage),
        lifecycleRules: [{
          enabled: true,
          expiration: Duration.days(7)
        }]
      }
    }
  })

  // create a workgroup to keep queries organized by `app.stage`
  // to use the queries below, Athena users must select the appropriate 
  // workspace in the query editor at:
  // https://console.aws.amazon.com/athena/home#/query-editor
  const workgroupName = getCdkNames('w3up', app.stage)
  const workgroup = new athena.CfnWorkGroup(stack, workgroupName, {
    name: workgroupName,
    workGroupConfiguration: {
      resultConfiguration: {
        outputLocation: `s3://${athenaResultsBucket.bucketName}`
      }
    }
  })

  // create a query that can be executed by going to 
  // https://console.aws.amazon.com/athena/home#/query-editor/saved-queries
  // and selecting the appropriate Workgroup from the dropdown in the upper right
  const inputOutputQueryName = getCdkNames('input-output-query', app.stage)
  const inputOutputQuery = new athena.CfnNamedQuery(stack, inputOutputQueryName, {
    name: "Inputs and Outputs, last 24 hours",
    description: `${app.stage} w3up preload`,
    database: databaseName,
    workGroup: workgroupName,
    queryString: `SELECT 
  value.att[1] as "in",
  out
FROM "AwsDataCatalog"."${databaseName}"."${receiptTableName}"
WHERE day >= (CURRENT_DATE - INTERVAL '1' DAY)
`
  })
  inputOutputQuery.addDependsOn(workgroup)
  inputOutputQuery.addDependsOn(receiptTable)

  // create a query that can be executed by going to 
  // https://console.aws.amazon.com/athena/home#/query-editor/saved-queries
  // and selecting the appropriate Workgroup from the dropdown in the upper right
  const dataStoredQueryName = getCdkNames('data-stored-query', app.stage)
  const dataStoredQuery = new athena.CfnNamedQuery(stack, dataStoredQueryName, {
    name: "Data stored by space, past 7 days",
    description: `${app.stage} w3up preload`,
    database: databaseName,
    workGroup: workgroupName,
    queryString: `SELECT
  SUM(value.att[1].nb.size) AS size,
  value.att[1]."with" AS space
FROM "AwsDataCatalog"."${databaseName}"."${storeAddTableName}"
WHERE out.ok IS NOT NULL
  AND day >= (CURRENT_DATE - INTERVAL '7' DAY)
GROUP BY value.att[1]."with"
`
  })
  dataStoredQuery.addDependsOn(workgroup)
  dataStoredQuery.addDependsOn(storeAddTable)

  // create a query that can be executed by going to 
  // https://console.aws.amazon.com/athena/home#/query-editor/saved-queries
  // and selecting the appropriate Workgroup from the dropdown in the upper right
  const storesBySpaceQueryName = getCdkNames('stores-by-space-query', app.stage)
  const storesBySpaceQuery = new athena.CfnNamedQuery(stack, storesBySpaceQueryName, {
    name: "Stores, past 7 days",
    description: `${app.stage} w3up preload
    
Recent uploaded CARs by Customer email and CID`,
    database: databaseName,
    workGroup: workgroupName,
    queryString: `WITH 
spaces AS (
  SELECT value.att[1].nb.consumer AS did,
  value.att[1]."with" AS account
  FROM "AwsDataCatalog"."${databaseName}"."${providerAddTableName}"  
  WHERE out.ok IS NOT NULL 
), 
stores AS (
  SELECT value.att[1].nb.link._cid_slash AS cid,
         value.att[1]."with" AS space,
         ts
  FROM "AwsDataCatalog"."${databaseName}"."${storeAddTableName}" 
  WHERE out.ok IS NOT NULL
    -- query by both day and ts because day engages partitioning and ts filters out data on the first day in the range
    AND day >= (CURRENT_DATE - INTERVAL '7' DAY)
    AND ts >= (CURRENT_TIMESTAMP - INTERVAL '7' DAY)
),
stores_by_account AS (
  SELECT stores.cid AS cid,
         spaces.account AS account,
         spaces.did AS space, 
         stores.ts AS ts
  FROM stores LEFT JOIN spaces on spaces.did = stores.space
) SELECT * 
  FROM stores_by_account 
  ORDER BY ts
`
  })
  storesBySpaceQuery.addDependsOn(workgroup)
  storesBySpaceQuery.addDependsOn(providerAddTable)
  storesBySpaceQuery.addDependsOn(storeAddTable)

  // create a query that can be executed by going to 
  // https://console.aws.amazon.com/athena/home#/query-editor/saved-queries
  // and selecting the appropriate Workgroup from the dropdown in the upper right
  const uploadsQueryName = getCdkNames('uploads-query', app.stage)
  const uploadsQuery = new athena.CfnNamedQuery(stack, uploadsQueryName, {
    name: "Uploads, past 7 days",
    description: `${app.stage} w3up preload
    
Recent uploaded content by Customer email and CID`,
    database: databaseName,
    workGroup: workgroupName,
    queryString: `WITH 
spaces AS (
  SELECT value.att[1].nb.consumer AS did,
  value.att[1]."with" AS account
  FROM "AwsDataCatalog"."${databaseName}"."${providerAddTableName}"  
  WHERE out.ok IS NOT NULL 
), 
uploads AS (
  SELECT value.att[1].nb.root._cid_slash AS cid,
         value.att[1]."with" AS space,
         ts
  FROM "AwsDataCatalog"."${databaseName}"."${uploadAddTableName}" 
  WHERE out.ok IS NOT NULL
    -- query by both day and ts because day engages partitioning and ts filters out data on the first day in the range
    AND day >= (CURRENT_DATE - INTERVAL '7' DAY)
    AND ts >= (CURRENT_TIMESTAMP - INTERVAL '7' DAY)
),
uploads_by_account AS (
  SELECT uploads.cid AS cid,
         spaces.account AS account,
         spaces.did AS space, 
         uploads.ts AS ts
  FROM uploads LEFT JOIN spaces on spaces.did = uploads.space
) SELECT * 
  FROM uploads_by_account 
  ORDER BY ts
  `
  })
  uploadsQuery.addDependsOn(workgroup)
  uploadsQuery.addDependsOn(providerAddTable)
  uploadsQuery.addDependsOn(uploadAddTable)

  // create a query that can be executed by going to 
  // https://console.aws.amazon.com/athena/home#/query-editor/saved-queries
  // and selecting the appropriate Workgroup from the dropdown in the upper right
  const uploadVolumeSizeQueryName = getCdkNames('upload-volume-size-query', app.stage)
  const uploadVolumeSizeQuery = new athena.CfnNamedQuery(stack, uploadVolumeSizeQueryName, {
    name: "Users with highest upload volume (by size), past day",
    description: `${app.stage} w3up preload
    
Global view of users with most upload volume (by size) in the last 24 hours by their registered email`,
    database: databaseName,
    workGroup: workgroupName,
    queryString: `WITH 
spaces AS (
  SELECT value.att[1].nb.consumer AS did,
         value.att[1]."with" AS account
  FROM "AwsDataCatalog"."${databaseName}"."${providerAddTableName}"  
  WHERE out.ok IS NOT NULL 
), 
stores AS (
  SELECT value.att[1].nb.size AS size,
         value.att[1]."with" AS space
  FROM "AwsDataCatalog"."${databaseName}"."${storeAddTableName}" 
  WHERE out.ok IS NOT NULL
    -- query by both day and ts because day engages partitioning and ts filters out data on the first day in the range
    AND day >= (CURRENT_DATE - INTERVAL '1' DAY)
    AND ts >= (CURRENT_TIMESTAMP - INTERVAL '1' DAY)
),
stores_by_account AS (
  SELECT spaces.account AS account,
         stores.size AS size         
  FROM stores LEFT JOIN spaces on spaces.did = stores.space
) SELECT account, SUM(size) as size
  FROM stores_by_account 
  GROUP BY account
  ORDER BY size DESC
`
  })
  uploadVolumeSizeQuery.addDependsOn(workgroup)
  uploadVolumeSizeQuery.addDependsOn(providerAddTable)
  uploadVolumeSizeQuery.addDependsOn(storeAddTable)

  // create a query that can be executed by going to
  // https://console.aws.amazon.com/athena/home#/query-editor/saved-queries
  // and selecting the appropriate Workgroup from the dropdown in the upper right
  const uploadVolumeCountQueryName = getCdkNames('upload-volume-count-query', app.stage)
  const uploadVolumeCountQuery = new athena.CfnNamedQuery(stack, uploadVolumeCountQueryName, {
    name: "Users with highest upload volume (by count), past day",
    description: `${app.stage} w3up preload
    
Global view of users with most upload volume (by count) in the last 24 hours by their registered email`,
    database: databaseName,
    workGroup: workgroupName,
    queryString: `WITH 
spaces AS (
  SELECT value.att[1].nb.consumer AS did,
         value.att[1]."with" AS account
  FROM "AwsDataCatalog"."${databaseName}"."${providerAddTableName}"
  WHERE out.ok IS NOT NULL 
), 
uploads AS (
  SELECT value.att[1].nb.root._cid_slash AS cid,
         value.att[1]."with" AS space,
         1 AS count
  FROM "AwsDataCatalog"."${databaseName}"."${uploadAddTableName}"
  WHERE out.ok IS NOT NULL
    -- query by both day and ts because day engages partitioning and ts filters out data on the first day in the range
    AND day >= (CURRENT_DATE - INTERVAL '1' DAY)
    AND ts >= (CURRENT_TIMESTAMP - INTERVAL '1' DAY)
),
uploads_by_account AS (
  SELECT spaces.account AS account,
         uploads.count AS count
  FROM uploads LEFT JOIN spaces on spaces.did = uploads.space
) SELECT account, SUM(count) as count
  FROM uploads_by_account 
  GROUP BY account
  ORDER BY count DESC
`
  })
  uploadVolumeCountQuery.addDependsOn(workgroup)
  uploadVolumeCountQuery.addDependsOn(providerAddTable)
  uploadVolumeCountQuery.addDependsOn(storeAddTable)

  // create a query that can be executed by going to
  // https://console.aws.amazon.com/athena/home#/query-editor/saved-queries
  // and selecting the appropriate Workgroup from the dropdown in the upper right
  const uploadsBySpaceAndSizeQueryName = getCdkNames('uploads-by-space-and-size', app.stage)
  const uploadsBySpaceAndSizeQuery = new athena.CfnNamedQuery(stack, uploadsBySpaceAndSizeQueryName, {
    name: "Uploads by space and size, last 2 days",
    description: `${app.stage} w3up preload
    
Uploads over the last 2 days, with size aggregated from corresponding "store" operations.`,
    database: databaseName,
    workGroup: workgroupName,
    queryString: `WITH 
uploads_by_shard AS (
  SELECT 
    carcid AS id,
    ts,
    uploads.value.att[1]."with" AS space,
    uploads.value.att[1].nb.root._cid_slash AS root,
    shards.cid._cid_slash AS shard
  FROM "AwsDataCatalog"."${databaseName}"."${uploadAddTableName}" AS uploads
  CROSS JOIN UNNEST(uploads.value.att[1].nb.shards) AS shards (cid)
  WHERE uploads.day >= (CURRENT_DATE - INTERVAL '2' DAY)
),
stores_by_size AS (
  SELECT
    carcid AS id,
    ts,
    stores.value.att[1].nb.link._cid_slash AS cid,
    stores.value.att[1].nb.size AS size
  FROM "AwsDataCatalog"."${databaseName}"."${storeAddTableName}" AS stores
  WHERE stores.day >= (CURRENT_DATE - INTERVAL '2' DAY)
),
upload_shards_by_size AS (
  SELECT DISTINCT
    uploads_by_shard.ts AS upload_ts,
    uploads_by_shard.space AS space,
    uploads_by_shard.root AS content_cid,
    stores_by_size.cid AS car_cid,
    stores_by_size.size AS size
  FROM uploads_by_shard JOIN stores_by_size ON uploads_by_shard.shard = stores_by_size.cid
) SELECT  
  upload_ts,
  space,
  content_cid,
  SUM(size) AS size
FROM upload_shards_by_size
WHERE upload_ts >= (CURRENT_TIMESTAMP - INTERVAL '2' DAY)
GROUP BY upload_ts, space, content_cid
ORDER BY upload_ts DESC
`
  })
  uploadsBySpaceAndSizeQuery.addDependsOn(workgroup)
  uploadsBySpaceAndSizeQuery.addDependsOn(uploadAddTable)
  uploadsBySpaceAndSizeQuery.addDependsOn(storeAddTable)

  // create a query that can be executed by going to 
  // https://console.aws.amazon.com/athena/home#/query-editor/saved-queries
  // and selecting the appropriate Workgroup from the dropdown in the upper right
  const aggregateHoursToDataCommitedQueryName = getCdkNames('aggregate-hours-to-data-commited-query', app.stage)
  const aggregateHoursToDataCommitedQuery = new athena.CfnNamedQuery(stack, aggregateHoursToDataCommitedQueryName, {
    name: "Hours to data commited per aggregate in the last 7 days",
    description: `${app.stage} w3up preload
    
Hours to data commited per aggregate in the last 7 days`,
    database: databaseName,
    workGroup: workgroupName,
    queryString: `WITH 
accepted_aggregates AS (
  SELECT value.att[1].nb.aggregate._cid_slash as cid,
         ts as accept_ts
  FROM "AwsDataCatalog"."${databaseName}"."${aggregateAcceptTableName}"
  WHERE ts >= (CURRENT_TIMESTAMP - INTERVAL '7' DAY)
)
SELECT cid,
       ts as offer_ts,
       accept_ts,
       CAST((to_unixtime(accept_ts) - to_unixtime(ts))/3600 as integer) as hrs_to_data_commited
FROM "AwsDataCatalog"."${databaseName}."${aggregateOfferTableName}"
INNER JOIN accepted_aggregates ON accepted_aggregates.cid = value.att[1].nb.aggregate._cid_slash
`
  })
  aggregateHoursToDataCommitedQuery.addDependsOn(workgroup)
  aggregateHoursToDataCommitedQuery.addDependsOn(aggregateAcceptTable)
  aggregateHoursToDataCommitedQuery.addDependsOn(aggregateOfferTable)

  // configure the Athena Dynamo connector

  // Considering Lambda functions limits response sizes, responses larger than the threshold 
  // spill into an Amazon S3 location that you specify when you create your Lambda function. 
  // Athena reads these responses from Amazon S3 directly.
  const athenaDynamoSpillBucket = new Bucket(stack, 'athena-dynamo-spill', {
    cors: true,
    cdk: {
      bucket: {
        ...getBucketConfig('athena-dynamo-spill', app.stage),
        lifecycleRules: [{
          enabled: true,
          expiration: Duration.days(1)
        }]
      }
    }
  })

  const dynamoAthenaLambdaName = getCdkNames('dynamo-athena', app.stage)
  const athenaDynamoConnector = new sam.CfnApplication(stack, getCdkNames('athena-dynamo-connector', app.stage), {
    // I got this ARN and version from the AWS admin UI after configuring the Athena Dynamo connector manually using these instructions:
    // https://docs.aws.amazon.com/athena/latest/ug/connect-data-source-serverless-app-repo.html
    location: {
      applicationId: 'arn:aws:serverlessrepo:us-east-1:292517598671:applications/AthenaDynamoDBConnector',
      semanticVersion: '2023.38.1'
    },
    parameters: {
      AthenaCatalogName: dynamoAthenaLambdaName,
      SpillBucket: athenaDynamoSpillBucket.bucketName
    }
  })

  // creates an Athena data source that will enable Athena to query our dynamo tables:
  // https://console.aws.amazon.com/athena/home#/data-sources
  const dynamoDataCatalogName = getCdkNames('dynamo-data-catalog', app.stage)
  const dynamoDataCatalogDatabaseName = getCdkNames('dynamo', app.stage)
  const dynamoDataCatalog = new athena.CfnDataCatalog(stack, dynamoDataCatalogName, {
    name: dynamoDataCatalogDatabaseName,
    type: 'LAMBDA',
    parameters: {
      function: `arn:aws:lambda:${stack.region}:${stack.account}:function:${dynamoAthenaLambdaName}`
    }
  })
  dynamoDataCatalog.addDependsOn(athenaDynamoConnector)

  // queries that depend on the Athena Dynamo connector

  // create a query that can be executed by going to
  // https://console.aws.amazon.com/athena/home#/query-editor/saved-queries
  // and selecting the appropriate Workgroup from the dropdown in the upper right
  const spacesByAccountQueryName = getCdkNames('spaces-by-account-query', app.stage)
  const spacesByAccountQuery = new athena.CfnNamedQuery(stack, spacesByAccountQueryName, {
    name: "Dynamo: spaces by account",
    description: `${app.stage} w3up preload`,
    database: databaseName,
    workGroup: workgroupName,
    queryString: `SELECT 
  customer as account,
  consumer as space
FROM "${dynamoDataCatalogDatabaseName}"."default"."${app.stage}-w3infra-subscription" AS sub 
  LEFT JOIN "${dynamoDataCatalogDatabaseName}"."default"."${app.stage}-w3infra-consumer" AS space 
  ON space.subscription = sub.subscription
`
  })
  spacesByAccountQuery.addDependsOn(dynamoDataCatalog)
  spacesByAccountQuery.addDependsOn(workgroup)

  // create a query that can be executed by going to
  // https://console.aws.amazon.com/athena/home#/query-editor/saved-queries
  // and selecting the appropriate Workgroup from the dropdown in the upper right
  const uploadsByAccountQueryName = getCdkNames('uploads-by-account-query', app.stage)
  const uploadsByAccountQuery = new athena.CfnNamedQuery(stack, uploadsByAccountQueryName, {
    name: "Dynamo: uploads by account",
    description: `${app.stage} w3up preload`,
    database: databaseName,
    workGroup: workgroupName,
    queryString: `WITH 
spaces AS (
  SELECT customer as account,
         consumer as did
  FROM "${dynamoDataCatalogDatabaseName}"."default"."${app.stage}-w3infra-subscription" AS sub 
  LEFT JOIN "${dynamoDataCatalogDatabaseName}"."default"."${app.stage}-w3infra-consumer" AS space 
  ON space.subscription = sub.subscription
), 
uploads AS (
  SELECT value.att[1].nb.root._cid_slash AS cid,
         value.att[1]."with" AS space,
         ts
  FROM "AwsDataCatalog"."${databaseName}"."${receiptTableName}" 
  WHERE value.att[1].can='upload/add' 
    AND out.ok IS NOT NULL 
    AND type='receipt'
),
uploads_by_account AS (
  SELECT spaces.did AS space, 
         spaces.account AS account,
         uploads.cid AS cid,
         uploads.ts AS "timestamp"
  FROM uploads LEFT JOIN spaces on spaces.did = uploads.space
) SELECT * 
  FROM uploads_by_account 
  ORDER BY timestamp
`
  })
  uploadsByAccountQuery.addDependsOn(receiptTable)
  uploadsByAccountQuery.addDependsOn(dynamoDataCatalog)
  uploadsByAccountQuery.addDependsOn(workgroup)

}
