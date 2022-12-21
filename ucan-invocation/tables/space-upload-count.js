import {
  DynamoDBClient,
  TransactWriteItemsCommand,
} from '@aws-sdk/client-dynamodb'
import { marshall } from '@aws-sdk/util-dynamodb'

import { MAX_TRANSACT_WRITE_ITEMS } from './constants.js'

/**
 * @typedef {import('@ucanto/interface').Ability} Ability
 * @typedef {import('@ucanto/interface').Capability<Ability, `${string}:${string}`, unknown>[]} Capabilities
 * 
 * @typedef {object} UpdateInput
 * @property {`did:${string}:${string}`} space
 * @property {number} count
 */

/**
 * Abstraction layer to handle operations on Space Upload Count Table.
 *
 * @param {string} region
 * @param {string} tableName
 * @param {object} [options]
 * @param {string} [options.endpoint]
 * @returns {import('../types').UploadCountTable}
 */
export function createUploadCountTable (region, tableName, options = {}) {
  const dynamoDb = new DynamoDBClient({
    region,
    endpoint: options.endpoint
  })

  return {
    /**
     * Increment accumulated count from new given operations.
     *
     * @param {Capabilities} uploadAddInv
     */
    increment: async (uploadAddInv) => {
      // Merge same space operations into single one and transform into transaction format
      // We cannot have multiple operations in a TransactWrite with same key, and we
      // decrease the probability of reaching the maximum number of transactions.
      const updateInputTransactions = uploadAddInv.reduce((acc, c) => {
        const existing = acc?.find((e) => c.with === e.space)
        if (existing) {
          existing.count += 1
        } else {
          acc.push({
            // @ts-expect-error
            space: c.with,
            count: 1
          })
        }
        return acc
      }, /** @type {UpdateInput[]} */ ([]))

      if (updateInputTransactions.length >= MAX_TRANSACT_WRITE_ITEMS) {
        throw new Error(`Attempting to increment space count for more than allowed transactions: ${updateInputTransactions.length}`)
      }

      if (!updateInputTransactions.length) {
        return
      }

      /** @type {import('@aws-sdk/client-dynamodb').TransactWriteItem[]} */
      const transactItems = updateInputTransactions.map(item => ({
        Update: {
          TableName: tableName,
          UpdateExpression: `ADD #count :count`,
          ExpressionAttributeNames: {'#count': 'count'},
          ExpressionAttributeValues: {
            ':count': { N: String(item.count) },
          },
          Key: marshall({
            space: item.space
          }),
        }
      }))
      const cmd = new TransactWriteItemsCommand({
        TransactItems: transactItems
      })

      await dynamoDb.send(cmd)
    }
  }
}
