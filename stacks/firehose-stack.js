import { Bucket, use } from '@serverless-stack/resources'
import {
  Aws,
  Duration,
  aws_iam as iam,
  aws_logs as logs,
  aws_kinesisfirehose as firehose,
  aws_glue as glue,
  aws_athena as athena,
  aws_sam
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
                parameterValue: '{day: (.ts/1000) | strftime("%Y-%m-%d"), type: .type, op: (.value.att[0].can | sub("\/"; "_"))}',
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

  const tableName = getCdkNames('ucan-receipt-table', app.stage)
  const receiptTable = new glue.CfnTable(stack, tableName, {
    catalogId: Aws.ACCOUNT_ID,
    databaseName,
    tableInput: {
      name: tableName,
      partitionKeys: [
        { name: 'day', type: 'date' },
        { name: 'op', type: 'string'}
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
        "projection.op.values": 'store_add,upload_add,access_authorize,access_claim,access_delegate,provider_add',
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
          { name: "out", type: "STRUCT<error:STRUCT<name:STRING>,ok:STRUCT<link:STRUCT<_cid_slash:STRING>>>" },
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
  uploadAddTable.addDependsOn(glueDatabase)

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
  const workgroupName = getCdkNames('w3up', app.stage)
  const workgroup = new athena.CfnWorkGroup(stack, workgroupName, {
    name: workgroupName,
    workGroupConfiguration: {
      resultConfiguration: {
        outputLocation: `s3://${athenaResultsBucket.bucketName}`
      }
    }
  })
  workgroup.addDependsOn(receiptTable)

  const inputOutputQueryName = getCdkNames('input-output-query', app.stage)
  const inputOutputQuery = new athena.CfnNamedQuery(stack, inputOutputQueryName, {
    name: "Inputs and Outputs, last 24 hours",
    description: `${app.stage} w3up preload`,
    database: databaseName,
    workGroup: workgroupName,
    queryString: `SELECT 
  value.att[1] as "in",
  out
FROM "AwsDataCatalog"."${databaseName}"."${tableName}"
WHERE type = 'receipt'
  AND day > (CURRENT_DATE - INTERVAL '1' DAY)
`
  })
  inputOutputQuery.addDependsOn(workgroup)

  const dataStoredQueryName = getCdkNames('data-stored-query', app.stage)
  const dataStoredQuery = new athena.CfnNamedQuery(stack, dataStoredQueryName, {
    name: "Data stored by space, last week",
    description: `${app.stage} w3up preload`,
    database: databaseName,
    workGroup: workgroupName,
    queryString: `SELECT
  SUM(value.att[1].nb.size) AS size,
  value.att[1]."with" AS space
FROM "AwsDataCatalog"."${databaseName}"."${tableName}"
WHERE value.att[1].can='store/add'
  AND out.ok IS NOT NULL
  AND type='receipt'
  AND day > (CURRENT_DATE - INTERVAL '7' DAY)
GROUP BY value.att[1]."with"
`
  })
  dataStoredQuery.addDependsOn(workgroup)

  const storesBySpaceQueryName = getCdkNames('stores-by-space-query', app.stage)
  const storesBySpaceQuery = new athena.CfnNamedQuery(stack, storesBySpaceQueryName, {
    name: "Stores by space, last week",
    description: `${app.stage} w3up preload`,
    database: databaseName,
    workGroup: workgroupName,
    queryString: `SELECT
  value.att[1].nb.size AS size,
  value.att[1]."with" AS space,
  ts
FROM "AwsDataCatalog"."${databaseName}"."${tableName}"
WHERE value.att[1].can='store/add'
  AND day > (CURRENT_DATE - INTERVAL '2' DAY)
  AND out.ok IS NOT NULL
  AND type='receipt'
`
  })
  storesBySpaceQuery.addDependsOn(workgroup)

  const uploadsQueryName = getCdkNames('uploads-query', app.stage)
  const uploadsQuery = new athena.CfnNamedQuery(stack, uploadsQueryName, {
    name: "Uploads, last week",
    description: `${app.stage} w3up preload`,
    database: databaseName,
    workGroup: workgroupName,
    queryString: `SELECT
  value.att[1].nb.root._cid_slash AS cid,
  value.att[1]."with" AS space,
  ts
FROM "AwsDataCatalog"."${databaseName}"."${tableName}"
WHERE value.att[1].can='upload/add'
  AND day > (CURRENT_DATE - INTERVAL '7' DAY)
  AND out.ok IS NOT NULL
  AND type='receipt'
ORDER BY ts
`
  })
  uploadsQuery.addDependsOn(workgroup)

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
  const athenaDynamoConnector = new aws_sam.CfnApplication(stack, getCdkNames('athena-dynamo-connector', app.stage), {
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

  const spacesByAccountQueryName = getCdkNames('spaces-by-account-query', app.stage)
  const spacesByAccountQuery = new athena.CfnNamedQuery(stack, spacesByAccountQueryName, {
    name: "Spaces by account",
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

  const uploadsByAccountQueryName = getCdkNames('uploads-by-account-query', app.stage)
  const uploadsByAccountQuery = new athena.CfnNamedQuery(stack, uploadsByAccountQueryName, {
    name: "Uploads by account",
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
  FROM "AwsDataCatalog"."${databaseName}"."${tableName}" 
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
