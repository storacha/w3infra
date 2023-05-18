import {
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
  DeleteItemCommand,
  QueryCommand,
} from '@aws-sdk/client-dynamodb'
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb'
import { CID } from 'multiformats/cid'
import * as Link from 'multiformats/link'

/**
 * @typedef {import('../types').ConsumerTable} ConsumerTable
 * @typedef {import('../types').ConsumerInput} ConsumerInput
 * @typedef {import('../types').Consumer} Consumer
 */

/**
 * Abstraction layer to handle operations on Store Table.
 *
 * @param {string} region
 * @param {string} tableName
 * @param {object} [options]
 * @param {string} [options.endpoint]
 */
export function createConsumerTable (region, tableName, options = {}) {
  const dynamoDb = new DynamoDBClient({
    region,
    endpoint: options.endpoint,
  })

  return useConsumerTable(dynamoDb, tableName)
}

/**
 * @param {DynamoDBClient} dynamoDb
 * @param {string} tableName
 * @returns {ConsumerTable}
 */
export function useConsumerTable (dynamoDb, tableName) {
  return {
    /**
     * Record the fact that a consumer is consuming a provider via a subscription
     *
     * @param {ConsumerInput} item
     * @returns {Promise<Consumer>}
     */
    insert: async ({ consumer, provider, order, cause }) => {
      const insertedAt = new Date().toISOString()

      const item = {
        consumer,
        provider,
        order,
        cause: cause.toString(),
        insertedAt,
      }

      const cmd = new PutItemCommand({
        TableName: tableName,
        Item: marshall(item, { removeUndefinedValues: true }),
      })

      await dynamoDb.send(cmd)
      return {}
    }
  }
}