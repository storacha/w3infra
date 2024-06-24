import { Queue, Table } from 'sst/constructs'
import * as sqs from 'aws-cdk-lib/aws-sqs'
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb'
import { Duration } from 'aws-cdk-lib'
import { setupSentry, getEnv } from './config.js'
  
/** @param {import('sst/constructs').StackContext} properties */
export function IpniStack({ stack, app }) {
  const {
    EIPFS_MULTIHASHES_SQS_ARN,
    EIPFS_BLOCKS_CAR_POSITION_TABLE_ARN
  } = getEnv()

  // Setup app monitoring with Sentry
  setupSentry(app, stack)

  // https://docs.aws.amazon.com/IAM/latest/UserGuide/reference-arns.html#arns-syntax
  const indexerRegion = EIPFS_MULTIHASHES_SQS_ARN.split(':')[3]

  // Elastic IPFS event for multihashes
  const multihashesQueue = new Queue(stack, 'multihashes-topic-queue', {
    cdk: {
      queue: sqs.Queue.fromQueueArn(
        stack,
        'multihashes-topic',
        EIPFS_MULTIHASHES_SQS_ARN
      ),
    },
  })

  const blocksCarPositionTable = new Table(stack, 'blocks-car-position-table', {
    cdk: {
      table: dynamodb.Table.fromTableArn(
        stack,
        'blocks-car-position',
        EIPFS_BLOCKS_CAR_POSITION_TABLE_ARN
      ),
    },
  })

  const blockAdvertPublisherQueue = new Queue(stack, 'block-advert-publisher-queue')
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

  const blockIndexWriterQueue = new Queue(stack, 'block-index-writer-queue')
  const blockIndexWriterDLQ = new Queue(stack, 'block-index-writer-dlq', {
    cdk: { queue: { retentionPeriod: Duration.days(14) } }
  })
  blockIndexWriterQueue.addConsumer(stack, {
    function: {
      handler: 'ipni/functions/handle-block-index-writer-message.main',
      environment : {
        BLOCKS_CAR_POSITION_TABLE_NAME: blocksCarPositionTable.tableName,
        INDEXER_REGION: indexerRegion
      },
      permissions: [blocksCarPositionTable],
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
  