import { Queue, Table } from 'sst/constructs'
import * as sqs from 'aws-cdk-lib/aws-sqs'
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb'
import { getEnv } from './config.js'
  
/** @param {import('sst/constructs').StackContext} properties */
export function ElasticIpfsStack({ stack }) {
  const {
    EIPFS_MULTIHASHES_SQS_ARN,
    EIPFS_BLOCKS_CAR_POSITION_TABLE_ARN
  } = getEnv()

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

  const blocksCarsPositionTable = new Table(stack, 'eipfs-blocks-cars-position-table', {
    cdk: {
      table: dynamodb.Table.fromTableArn(
        stack,
        'blocks-cars-position',
        EIPFS_BLOCKS_CAR_POSITION_TABLE_ARN
      ),
    },
  })

  return { multihashesQueue, blocksCarsPositionTable, indexerRegion }
}
