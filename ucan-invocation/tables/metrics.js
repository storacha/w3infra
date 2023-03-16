import {
  DynamoDBClient,
  UpdateItemCommand
} from '@aws-sdk/client-dynamodb'
import { marshall } from '@aws-sdk/util-dynamodb'

import { METRICS_NAMES } from '../constants.js'

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
 * @returns {import('../types').MetricsTable}
 */
export function createMetricsTable (region, tableName, options = {}) {
  const dynamoDb = new DynamoDBClient({
    region,
    endpoint: options.endpoint
  })

  return {
    /**
     * Increment total count from store/add operations.
     *
     * @param {Capabilities} operationsInv
     */
    incrementStoreAddTotal: async (operationsInv) => {
      const invTotalSize = operationsInv.length

      const updateCmd = new UpdateItemCommand({
        TableName: tableName,
        UpdateExpression: `ADD #value :value`,
          ExpressionAttributeNames: {'#value': 'value'},
          ExpressionAttributeValues: {
            ':value': { N: String(invTotalSize) },
          },
        Key: marshall({
          name: METRICS_NAMES.STORE_ADD_TOTAL
        })
      })

      await dynamoDb.send(updateCmd)
    },
    /**
     * Increment total value from new given operations.
     *
     * @param {Capabilities} operationsInv
     */
    incrementStoreAddSizeTotal: async (operationsInv) => {
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
          name: METRICS_NAMES.STORE_ADD_SIZE_TOTAL
        })
      })

      await dynamoDb.send(updateCmd)
    },
    /**
     * Increment total count from store/remove operations.
     *
     * @param {Capabilities} operationsInv
     */
    incrementStoreRemoveTotal: async (operationsInv) => {
      const invTotalSize = operationsInv.length

      const updateCmd = new UpdateItemCommand({
        TableName: tableName,
        UpdateExpression: `ADD #value :value`,
          ExpressionAttributeNames: {'#value': 'value'},
          ExpressionAttributeValues: {
            ':value': { N: String(invTotalSize) },
          },
        Key: marshall({
          name: METRICS_NAMES.STORE_REMOVE_TOTAL
        })
      })

      await dynamoDb.send(updateCmd)
    },
    /**
     * Increment total count from upload/remove operations.
     *
     * @param {Capabilities} operationsInv
     */
    incrementUploadRemoveTotal: async (operationsInv) => {
      const invTotalSize = operationsInv.length

      const updateCmd = new UpdateItemCommand({
        TableName: tableName,
        UpdateExpression: `ADD #value :value`,
          ExpressionAttributeNames: {'#value': 'value'},
          ExpressionAttributeValues: {
            ':value': { N: String(invTotalSize) },
          },
        Key: marshall({
          name: METRICS_NAMES.UPLOAD_REMOVE_TOTAL
        })
      })

      await dynamoDb.send(updateCmd)
    }
    ,
    /**
     * Increment total count from upload/add operations.
     *
     * @param {Capabilities} operationsInv
     */
    incrementUploadAddTotal: async (operationsInv) => {
      const invTotalSize = operationsInv.length

      const updateCmd = new UpdateItemCommand({
        TableName: tableName,
        UpdateExpression: `ADD #value :value`,
          ExpressionAttributeNames: {'#value': 'value'},
          ExpressionAttributeValues: {
            ':value': { N: String(invTotalSize) },
          },
        Key: marshall({
          name: METRICS_NAMES.UPLOAD_ADD_TOTAL
        })
      })

      await dynamoDb.send(updateCmd)
    }
  }
}
