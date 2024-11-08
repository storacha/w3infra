import {
  Bucket,
  KinesisStream,
} from 'sst/constructs'
import { PolicyStatement, StarPrincipal, Effect } from 'aws-cdk-lib/aws-iam'

import {
  getBucketConfig,
  getKinesisStreamConfig,
  setupSentry
} from './config.js'

/**
 * @param {import('sst/constructs').StackContext} properties
 */
export function UcanInvocationStack({ stack, app }) {
  // Setup app monitoring with Sentry
  setupSentry(app, stack)

  const agentMessageBucket = new Bucket(stack, 'agent-message', {
    cors: true,
    cdk: {
      bucket: {
        ...getBucketConfig('agent-message', app.stage),
        // change the defaults accordingly to allow access via new Policy
        blockPublicAccess: {
          blockPublicAcls: true,
          ignorePublicAcls: true,
          restrictPublicBuckets: false,
          blockPublicPolicy: false,
        }
      },
    }
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

  const agentIndexBucket = new Bucket(stack, 'agent-index', {
    cors: true,
    cdk: {
      bucket: getBucketConfig('agent-index', app.stage)
    }
  })

  // create a kinesis stream
  const ucanStream = new KinesisStream(stack, 'ucan-stream', {
    cdk: {
      stream: getKinesisStreamConfig(stack)
    }
  })

  stack.addOutputs({
    agentMessageBucketName: agentMessageBucket.bucketName,
    agentIndexBucketName: agentIndexBucket.bucketName,
  })

  return {
    agentIndexBucket,
    agentMessageBucket,
    ucanStream
  }
}
