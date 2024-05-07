import { base58btc } from 'multiformats/bases/base58'
import { error, ok } from '@ucanto/server'
import { useIPNIService, BlockAdvertisementPublisher, BlockIndexStore } from '../../external-services/ipni-service.js'
import { blocksCarsPositionTableProps } from '../../tables/index.js'
import { createTable, createQueue } from '../helpers/resources.js'
import { collectQueueMessages } from './queue.js'
import { RecordNotFound } from '@web3-storage/upload-api/errors'

/**
 * @param {{ sqs: import('@aws-sdk/client-sqs').SQSClient, dynamo: import('@aws-sdk/client-dynamodb').DynamoDBClient }} config
 */
export const createTestIPNIService = async ({ sqs, dynamo }) => {
  const queueURL = await createQueue(sqs, 'multihashes')
  const blockAdvertPublisher = new BlockAdvertisementPublisher({
    client: sqs,
    url: queueURL
  })

  const tableName = await createTable(dynamo, blocksCarsPositionTableProps)
  const blockIndexStore = new BlockIndexStore({
    client: dynamo,
    name: tableName
  })

  const messages = new Set()
  return Object.assign(
    useIPNIService(blockAdvertPublisher, blockIndexStore),
    {
      /** @param {import('multiformats').MultihashDigest} digest */
      async query (digest) {
        const collection = await collectQueueMessages(sqs, queueURL)
        for (const m of collection) {
          messages.add(m)
        }

        return messages.has(base58btc.encode(digest.bytes))
          ? ok({})
          : error(new RecordNotFound())
      }
    }
  )
  
}


