import { Queue, use } from 'sst/constructs'
import { Duration } from 'aws-cdk-lib'
import { setupSentry } from './config.js'
import { ElasticIpfsStack } from './eipfs-stack.js'
  
/** @param {import('sst/constructs').StackContext} properties */
export function IpniStack({ stack, app }) {
  // Setup app monitoring with Sentry
  setupSentry(app, stack)

  const { multihashesQueue, blocksCarsPositionTable, indexerRegion } = use(ElasticIpfsStack)

  const blockAdvertPublisherQueue = new Queue(stack, 'block-advert-publisher-queue', {
    cdk: { queue: { visibilityTimeout: Duration.minutes(15) } }
  })
  const blockAdvertPublisherDLQ = new Queue(stack, 'block-advert-publisher-dlq', {
    cdk: { queue: { retentionPeriod: Duration.days(14) } }
  })
  blockAdvertPublisherQueue.addConsumer(stack, {
    function: {
      handler: 'ipni/functions/handle-block-advert-publish-message.main',
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

  const blockIndexWriterQueue = new Queue(stack, 'block-index-writer-queue', {
    cdk: { queue: { visibilityTimeout: Duration.minutes(15) } }
  })
  const blockIndexWriterDLQ = new Queue(stack, 'block-index-writer-dlq', {
    cdk: { queue: { retentionPeriod: Duration.days(14) } }
  })
  blockIndexWriterQueue.addConsumer(stack, {
    function: {
      handler: 'ipni/functions/handle-block-index-writer-message.main',
      environment : {
        BLOCKS_CAR_POSITION_TABLE_NAME: blocksCarsPositionTable.tableName,
        INDEXER_REGION: indexerRegion
      },
      permissions: [blocksCarsPositionTable],
      timeout: 15 * 60,
    },
    deadLetterQueue: blockIndexWriterDLQ.cdk.queue,
    cdk: {
      eventSource: {
        batchSize: 1
      },
    },
  })

  return { blockAdvertPublisherQueue, blockIndexWriterQueue }
}
  