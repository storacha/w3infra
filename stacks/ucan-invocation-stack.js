import { Bucket, KinesisStream, Table } from 'sst/constructs'
import { PolicyStatement, StarPrincipal, Effect } from 'aws-cdk-lib/aws-iam'

import {
  getBucketConfig,
  getKinesisStreamConfig,
  setupSentry,
} from './config.js'
import { agentIndexTableProps } from '../upload-api/tables/index.js'

/**
 * @param {import('sst/constructs').StackContext} properties
 */
export function UcanInvocationStack({ stack, app }) {
  // Setup app monitoring with Sentry
  setupSentry(app, stack)

  const agentMessageBucket = new Bucket(stack, 'workflow-store', {
    cors: true,
    cdk: {
      bucket: {
        ...getBucketConfig('workflow-store', app.stage, app.name),
        // change the defaults accordingly to allow access via new Policy
        blockPublicAccess: {
          blockPublicAcls: true,
          ignorePublicAcls: true,
          restrictPublicBuckets: false,
          blockPublicPolicy: false,
        },
      },
    },
  })
  // Make bucket public for `s3:GetObject` command
  agentMessageBucket.cdk.bucket.addToResourcePolicy(
    new PolicyStatement({
      actions: ['s3:GetObject'],
      effect: Effect.ALLOW,
      principals: [new StarPrincipal()],
      resources: [agentMessageBucket.cdk.bucket.arnForObjects('*')],
    })
  )

  const agentIndexTable = new Table(stack, 'agent-index', agentIndexTableProps)

  // TODO: keep for historical content that we might want to process
  new Bucket(stack, 'ucan-store', {
    cors: true,
    cdk: {
      bucket: getBucketConfig('ucan-store', app.stage, app.name),
    },
  })

  // TODO: keep for historical content that we might want to process
  // only needed for production
  if (stack.stage === 'production' || stack.stage === 'staging') {
    new KinesisStream(stack, 'ucan-stream', {
      cdk: {
        stream: getKinesisStreamConfig(stack),
      },
    })
  }

  // create a kinesis stream
  const ucanStream = new KinesisStream(stack, 'ucan-stream-v2', {
    cdk: {
      stream: getKinesisStreamConfig(stack),
    },
  })

  // Increase max record size to 10MiB (default is 1MiB).
  // The L2 Stream construct doesn't expose this property yet, so we use
  // a CloudFormation override on the underlying CfnStream.
  // @see https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-kinesis-stream.html
  const cfnStream = /** @type {import('aws-cdk-lib').CfnResource} */ (ucanStream.cdk.stream.node.defaultChild)
  cfnStream.addPropertyOverride('MaxRecordSizeInKiB', 10240)

  stack.addOutputs({
    agentMessageBucketName: agentMessageBucket.bucketName,
  })

  return {
    agentIndexTable,
    agentMessageBucket,
    ucanStream,
  }
}
