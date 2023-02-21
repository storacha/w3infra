import {
  DynamoDBClient,
  UpdateItemCommand
} from '@aws-sdk/client-dynamodb'
import { marshall } from '@aws-sdk/util-dynamodb'

import { W3_METRICS_NAMES } from '../constants.js'

/**
 * @typedef {import('@ucanto/interface').Ability} Ability
 * @typedef {import('@ucanto/interface').Capability<Ability, `${string}:${string}`, unknown>[]} Capabilities
 * 
 * @typedef {object} UpdateInput
 * @property {`did:${string}:${string}`} space
 * @property {number} count
 */

/**
 * Abstraction layer to handle operations on w3 metrics Table.
 *
 * @param {string} region
 * @param {string} tableName
 * @param {object} [options]
 * @param {string} [options.endpoint]
 * @returns {import('../types').W3MetricsTable}
 */
export function createW3MetricsTable (region, tableName, options = {}) {
  const dynamoDb = new DynamoDBClient({
    region,
    endpoint: options.endpoint
  })

  return {
    /**
     * Increment accumulated value from new given operations.
     *
     * @param {Capabilities} operationsInv
     */
    incrementAccumulatedSize: async (operationsInv) => {
      // @ts-expect-error
      const invTotalSize = operationsInv.reduce((acc, c) => acc + c.nb?.size, 0)

      const updateCmd = new UpdateItemCommand({
        TableName: tableName,
        UpdateExpression: `ADD #value :value`,
          ExpressionAttributeNames: {'#value': 'value'},
          ExpressionAttributeValues: {
            ':value': { N: String(invTotalSize) },
          },
        Key: marshall({
          name: W3_METRICS_NAMES.STORE_ADD_ACCUM_SIZE
        })
      })

      await dynamoDb.send(updateCmd)
    }
  }
}
