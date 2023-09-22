import { Bucket, use } from '@serverless-stack/resources'
import {
  Aws,
  Duration,
  aws_iam as iam,
  aws_logs as logs,
  aws_kinesisfirehose as firehose,
  aws_glue as glue
} from 'aws-cdk-lib'
import { NamedQuery } from 'cdk-athena'

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
                parameterValue: '{day: (.ts/1000) | strftime("%Y-%m-%d")}',
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
      prefix: 'logs/!{partitionKeyFromQuery:day}/',
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

  const tableName = getCdkNames('ucan-stream-delivery-table', app.stage)
  const glueTable = new glue.CfnTable(stack, tableName, {
    catalogId: Aws.ACCOUNT_ID,
    databaseName,
    tableInput: {
      name: tableName,
      partitionKeys: [
        { name: 'day', type: 'date' },
      ],
      parameters: {
        classification: "json",
        typeOfData: "file",
        // See See https://docs.aws.amazon.com/athena/latest/ug/partition-projection-kinesis-firehose-example.html for more information on projection
        // configuration - this should match the "day" parameter and S3 prefix configured in the delivery stream
        "projection.enabled": "true",
        "projection.day.type": "date",
        "projection.day.format": "yyyy-MM-dd",
        "projection.day.range": "2023-01-01,NOW",
        "projection.day.interval": "1",
        "projection.day.interval.unit": "DAYS",
        "storage.location.template": `s3://${streamLogBucket.bucketName}/logs/\${day}/`
      },
      storageDescriptor: {
        location: `s3://${streamLogBucket.bucketName}/logs`,
        columns: [
          { name: 'carcid', type: 'string' },
          { name: 'type', type: 'string' },
          // STRUCT here refers to the Apache Hive STRUCT datatype - see https://aws.amazon.com/blogs/big-data/create-tables-in-amazon-athena-from-nested-json-and-mappings-using-jsonserde/
          { name: 'value', type: 'STRUCT<att:ARRAY<struct<can:STRING,with:STRING,nb:STRUCT<size:BIGINT,root:STRUCT<_cid_slash:STRING>,consumer:STRING>>>,iss:STRING,aud:STRING>' },
          { name: "out", type: "STRUCT<error:STRUCT<name:STRING>,ok:STRUCT<id:STRING,delegations:STRING>>" },
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

  glueTable.addDependsOn(glueDatabase)

  const inputOutputQueryName = getCdkNames('input-output-query', app.stage)
  new NamedQuery(stack, inputOutputQueryName, {
    name: "Inputs and Outputs, last 24 hours",
    desc: "(w3up preloaded)",
    database: databaseName,
    queryString: `SELECT 
  value.att[1] as "in",
  out
FROM "${tableName}"
WHERE type = 'receipt'
  AND day > (CURRENT_DATE - INTERVAL '1' DAY)
`
  })

  const dataStoredQueryName = getCdkNames('data-stored-query', app.stage)
  new NamedQuery(stack, dataStoredQueryName, {
    name: "Data stored by space, last week",
    desc: "(w3up preloaded)",
    database: databaseName,
    queryString: `SELECT
  SUM(value.att[1].nb.size) AS size,
  value.att[1]."with" AS space
FROM "${tableName}"
WHERE value.att[1].can='store/add'
  AND out.ok IS NOT NULL
  AND type='receipt'
  AND day > (CURRENT_DATE - INTERVAL '7' DAY)
GROUP BY value.att[1]."with"
`
  })

  const storesBySpaceQueryName = getCdkNames('stores-by-space-query', app.stage)
  new NamedQuery(stack, storesBySpaceQueryName, {
    name: "Stores by space, last week",
    desc: "(w3up preloaded)",
    database: databaseName,
    queryString: `SELECT
  value.att[1].nb.size AS size,
  value.att[1]."with" AS space,
  ts
FROM "${tableName}"
WHERE value.att[1].can='store/add'
  AND day > (CURRENT_DATE - INTERVAL '2' DAY)
  AND out.ok IS NOT NULL
  AND type='receipt'
`
  })

  const uploadsQueryName = getCdkNames('uploads-query', app.stage)
  new NamedQuery(stack, uploadsQueryName, {
    name: "Uploads, last week",
    desc: "(w3up preloaded)",
    database: databaseName,
    queryString: `SELECT
  value.att[1].nb.root._cid_slash AS cid,
  value.att[1]."with" AS space,
  ts
FROM "${tableName}"
WHERE value.att[1].can='upload/add'
  AND day > (CURRENT_DATE - INTERVAL '7' DAY)
  AND out.ok IS NOT NULL
  AND type='receipt'
ORDER BY ts
`
  })

  const spacesByAccountQueryName = getCdkNames('spaces-by-account-query', app.stage)
  new NamedQuery(stack, spacesByAccountQueryName, {
    name: "Spaces by account",
    desc: "(w3up preloaded)",
    database: databaseName,
    queryString: `SELECT
  value.att[1].nb.consumer AS space,
  value.att[1]."with" AS account
FROM "${tableName}" 
WHERE value.att[1].can='provider/add' 
  AND out.ok IS NOT NULL 
  AND type='receipt'
`
  })

  const uploadsByAccountQueryName = getCdkNames('uploads-by-account-query', app.stage)
  new NamedQuery(stack, uploadsByAccountQueryName, {
    name: "Uploads by account",
    desc: "(w3up preloaded)",
    database: databaseName,
    queryString: `WITH 
spaces AS (
  SELECT value.att[1].nb.consumer AS did,
         value.att[1]."with" AS account
  FROM "${tableName}" 
  WHERE value.att[1].can='provider/add' 
    AND out.ok IS NOT NULL 
    AND type='receipt'
), 
uploads AS (
  SELECT value.att[1].nb.root._cid_slash AS cid, 
         value.att[1]."with" AS space,
         ts
  FROM "${tableName}" 
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
}
