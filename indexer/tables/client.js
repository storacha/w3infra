import { BatchWriteItemCommand, DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { marshall } from '@aws-sdk/util-dynamodb'
import retry from 'p-retry'
import { StoreOperationFailure } from './lib.js'
import { getDynamoClient } from '../../lib/aws/dynamo.js'

/** The maximum size a DynamoDB batch can be. */
export const MAX_BATCH_SIZE = 25

/** @param {{ region: string } | DynamoDBClient} target */
export const connectTable = target =>
  target instanceof DynamoDBClient
    ? target
    : getDynamoClient(target)

/**
 * @template T
 * @param {{ region: string } | import('@aws-sdk/client-dynamodb').DynamoDBClient} conf
 * @param {object} context
 * @param {string} context.tableName
 * @param {import('../lib/api.js').Encoder<T, import('../types.js').StoreRecord>} context.encode
 * @returns {import('../lib/api.js').StoreBatchPutter<T>}
 */
export const createStoreBatchPutterClient = (conf, context) => {
  const client = connectTable(conf)
  return {
    batchPut: async (items) => {
      /** @type {import('@aws-sdk/client-dynamodb').WriteRequest[]} */
      const writeRequests = []
      for (const item of items) {
        const encoding = context.encode(item)
        if (encoding.error) return encoding
        writeRequests.push(({ PutRequest: { Item: marshall(encoding.ok, { removeUndefinedValues: true }) } }))
      }

      try {
        let requestItems = { [context.tableName]: writeRequests }
        await retry(async () => {
          const cmd = new BatchWriteItemCommand({ RequestItems: requestItems })
          const res = await client.send(cmd)
          if (res.UnprocessedItems && Object.keys(res.UnprocessedItems).length) {
            requestItems = res.UnprocessedItems
            throw new Error('unprocessed items')
          }
        }, { onFailedAttempt: console.warn })
        return { ok: {} }
      } catch (/** @type {any} */ err) {
        console.error(err)
        return { error: new StoreOperationFailure(err.message, { cause: err }) }
      }
    }
  }
}
