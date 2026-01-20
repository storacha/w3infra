import * as CAR from '@ucanto/transport/car'
import pRetry from 'p-retry'
import { PutObjectCommand } from '@aws-sdk/client-s3'

import { createBucket } from './resources.js'
import { createDynamoTable } from './tables.js'
import { encodeAgentMessage } from './ucan.js'

// table props
import { pieceTableProps } from '../../store/index.js'

// store clients
import { usePieceTable as createPieceStoreClient } from '../../store/piece.js'
import { useTaskStore as createTaskStoreClient } from '../../store/task.js'
import { useReceiptStore as createReceiptStoreClient } from '../../store/receipt.js'
import { TestContentStore } from './content-store.js'

// queue clients
import { createClient as createPieceOfferQueueClient } from '../../queue/piece-offer-queue.js'
import { createClient as createFilecoinSubmitQueueClient } from '../../queue/filecoin-submit-queue.js'
import { agentIndexTableProps } from '../../../upload-api/tables/index.js'
import { PutItemCommand } from '@aws-sdk/client-dynamodb'

/**
 * @param {import('./context.js').DynamoContext & import('./context.js').S3Context} ctx
 */
export async function getStores(ctx) {
  const { dynamoClient, s3Client } = ctx
  const pieceStore = await createDynamoTable(dynamoClient, pieceTableProps)
  const invocationTableName = await createDynamoTable(
    dynamoClient,
    agentIndexTableProps
  )
  const [workflowBucketName] = await Promise.all([createBucket(s3Client)])
  const testContentStore = await TestContentStore.activate()

  return {
    pieceStore: createPieceStoreClient(dynamoClient, pieceStore),
    taskStore: getTaskStoreClient(
      dynamoClient,
      s3Client,
      invocationTableName,
      workflowBucketName
    ),
    receiptStore: getReceiptStoreClient(
      dynamoClient,
      s3Client,
      invocationTableName,
      workflowBucketName
    ),
    contentStore: testContentStore.contentStore,
    testContentStore,
  }
}

/**
 * @param {import('./context.js').MultipleQueueContext} ctx
 */
export function getQueues(ctx) {
  return {
    filecoinSubmitQueue: createFilecoinSubmitQueueClient(ctx.sqsClient, {
      queueUrl: ctx.queues.filecoinSubmitQueue.queueUrl,
    }),
    pieceOfferQueue: createPieceOfferQueueClient(ctx.sqsClient, {
      queueUrl: ctx.queues.pieceOfferQueue.queueUrl,
    }),
  }
}

/**
 * @param {import('@aws-sdk/client-dynamodb').DynamoDBClient} dynamoDBClient
 * @param {import('@aws-sdk/client-s3').S3Client} s3client
 * @param {string} invocationTableName
 * @param {string} workflowBucketName
 * @returns {import('@storacha/filecoin-api/storefront/api').TaskStore}
 */
function getTaskStoreClient(
  dynamoDBClient,
  s3client,
  invocationTableName,
  workflowBucketName
) {
  const taskStore = createTaskStoreClient(
    dynamoDBClient,
    s3client,
    invocationTableName,
    workflowBucketName
  )

  return {
    ...taskStore,
    // Custom put for testing
    put: async (record) => {
      const invocations = [record]
      // Compute and store workflow
      const request = await encodeAgentMessage({ invocations })
      const carBytes = new Uint8Array(request.body.buffer)
      const decodedCar = CAR.codec.decode(carBytes)
      const agentMessageCarCid = decodedCar.roots[0].cid.toString()

      const putWorkflowCmd = new PutObjectCommand({
        Bucket: workflowBucketName,
        Key: `${agentMessageCarCid}/${agentMessageCarCid}`,
        Body: carBytes,
      })
      await pRetry(() => s3client.send(putWorkflowCmd))

      // store symlink of invocation
      const putInvocationCmd = new PutItemCommand({
        TableName: invocationTableName,
        Item: {
          taskkind: {
            S: `${record.cid.toString()}.in`,
          },
          identifier: {
            S: agentMessageCarCid.toString(),
          },
        },
      })
      await pRetry(() => dynamoDBClient.send(putInvocationCmd))

      return {
        ok: {},
      }
    },
  }
}

/**
 * @param {import('@aws-sdk/client-dynamodb').DynamoDBClient} dynamoDBClient
 * @param {import('@aws-sdk/client-s3').S3Client} s3client
 * @param {string} invocationTableName
 * @param {string} workflowBucketName
 * @returns {import('@storacha/filecoin-api/storefront/api').ReceiptStore}
 */
function getReceiptStoreClient(
  dynamoDBClient,
  s3client,
  invocationTableName,
  workflowBucketName
) {
  const receiptStore = createReceiptStoreClient(
    dynamoDBClient,
    s3client,
    invocationTableName,
    workflowBucketName
  )

  return {
    ...receiptStore,
    // Custom put for testing
    put: async (record) => {
      const receipts = [record]
      // Compute and store workflow
      const request = await encodeAgentMessage({ receipts })
      const carBytes = new Uint8Array(request.body.buffer)
      const decodedCar = CAR.codec.decode(carBytes)
      const agentMessageCarCid = decodedCar.roots[0].cid.toString()

      const putWorkflowCmd = new PutObjectCommand({
        Bucket: workflowBucketName,
        Key: `${agentMessageCarCid}/${agentMessageCarCid}`,
        Body: carBytes,
      })
      await pRetry(() => s3client.send(putWorkflowCmd))

      // store symlink of receipt
      const putInvocationCmd = new PutItemCommand({
        TableName: invocationTableName,
        Item: {
          taskkind: {
            S: `${record.ran.toString()}.out`,
          },
          identifier: {
            S: agentMessageCarCid.toString(),
          },
        },
      })
      await pRetry(() => dynamoDBClient.send(putInvocationCmd))

      return {
        ok: {},
      }
    },
  }
}
