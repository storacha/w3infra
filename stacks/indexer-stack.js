import { Queue } from 'sst/constructs'
import { Duration } from 'aws-cdk-lib'
import * as sqs from 'aws-cdk-lib/aws-sqs'
import { getEnv, setupSentry } from './config.js'

/** @param {import('sst/constructs').StackContext} properties */
export function IndexerStack({ stack, app }) {
  const {
    EIPFS_MULTIHASHES_SQS_ARN
  } = getEnv()

  // Setup app monitoring with Sentry
  setupSentry(app, stack)

  // https://docs.aws.amazon.com/IAM/latest/UserGuide/reference-arns.html#arns-syntax
  const indexerRegion = EIPFS_MULTIHASHES_SQS_ARN.split(':')[3]

  // Elastic IPFS event for multihashes
  const multihashesQueue = new Queue(stack, 'eipfs-multihashes-topic-queue', {
    cdk: {
      queue: sqs.Queue.fromQueueArn(
        stack,
        'multihashes-topic',
        EIPFS_MULTIHASHES_SQS_ARN
      ),
    },
  })

  const blockAdvertPublisherQueue = new Queue(stack, 'block-advert-publisher-queue', {
    cdk: { queue: { visibilityTimeout: Duration.minutes(15) } }
  })
  const blockAdvertPublisherDLQ = new Queue(stack, 'block-advert-publisher-dlq', {
    cdk: { queue: { retentionPeriod: Duration.days(14) } }
  })
  blockAdvertPublisherQueue.addConsumer(stack, {
    function: {
      handler: 'indexer/functions/handle-block-advert-publish-message.main',
      environment : {
        MULTIHASHES_QUEUE_URL: multihashesQueue.queueUrl,
        INDEXER_REGION: indexerRegion
      },
      permissions: [multihashesQueue],
      timeout: 15 * 60,
    },
    deadLetterQueue: blockAdvertPublisherDLQ.cdk.queue,
    cdk: {
      eventSource: {
        batchSize: 1
      },
    },
  })

  return { blockAdvertPublisherQueue }
}
