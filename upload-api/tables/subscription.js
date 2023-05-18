import {
  DescribeTableCommand,
  DynamoDBClient,
  //GetItemCommand,
  PutItemCommand,
  //DeleteItemCommand,
  //QueryCommand,
} from '@aws-sdk/client-dynamodb'
import { marshall, /*unmarshall*/ } from '@aws-sdk/util-dynamodb'
//import { CID } from 'multiformats/cid'
//import * as Link from 'multiformats/link'

/**
 * @typedef {import('../types').SubscriptionTable} SubscriptionTable
 * @typedef {import('../types').SubscriptionInput} SubscriptionInput
 * @typedef {import('../types').Subscription} Subscription
 */

/**
 * Abstraction layer to handle operations on Store Table.
 *
 * @param {string} region
 * @param {string} tableName
 * @param {object} [options]
 * @param {string} [options.endpoint]
 */
export function createSubscriptionTable (region, tableName, options = {}) {
  const dynamoDb = new DynamoDBClient({
    region,
    endpoint: options.endpoint,
  })

  return useSubscriptionTable(dynamoDb, tableName)
}

/**
 * @param {DynamoDBClient} dynamoDb
 * @param {string} tableName
 * @returns {SubscriptionTable}
 */
export function useSubscriptionTable (dynamoDb, tableName) {
  return {
    /**
     * Record the fact that a subscription is consuming a provider via a subscription
     *
     * @param {SubscriptionInput} item
     * @returns {Promise<Subscription>}
     */
    insert: async ({ customer, provider, subscription, cause }) => {
      const insertedAt = new Date().toISOString()

      const item = {
        customer,
        provider,
        subscription,
        cause: cause.toString(),
        insertedAt,
      }

      const cmd = new PutItemCommand({
        TableName: tableName,
        Item: marshall(item, { removeUndefinedValues: true }),
      })

      await dynamoDb.send(cmd)
      return {}
    },

    /**
     * get number of stored items
     */
    count: async () => {
      const result = await dynamoDb.send(new DescribeTableCommand({
        TableName: tableName
      }))

      return BigInt(result.Table?.ItemCount ?? -1)
    }
  }
}