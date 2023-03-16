import {
  DynamoDBClient,
  TransactWriteItemsCommand,
} from '@aws-sdk/client-dynamodb'
import { marshall } from '@aws-sdk/util-dynamodb'

import { SPACE_METRICS_NAMES } from '../constants.js'
import { MAX_TRANSACT_WRITE_ITEMS } from './constants.js'

/**
 * @typedef {import('@ucanto/interface').Ability} Ability
 * @typedef {import('@ucanto/interface').Capability<Ability, `${string}:${string}`, unknown>[]} Capabilities
 * 
 * @typedef {object} UpdateInput
 * @property {`did:${string}:${string}`} space
 * @property {number} value
 */

/**
 * Abstraction layer to handle operations on Space Metrics Table.
 *
 * @param {string} region
 * @param {string} tableName
 * @param {object} [options]
 * @param {string} [options.endpoint]
 * @returns {import('../types').SpaceMetricsTable}
 */
export function createSpaceMetricsTable (region, tableName, options = {}) {
  const dynamoDb = new DynamoDBClient({
    region,
    endpoint: options.endpoint
  })

  return {
    /**
     * Increment accumulated count from upload/add operations.
     *
     * @param {Capabilities} uploadAddInv
     */
    incrementUploadAddCount: async (uploadAddInv) => {
      const updateInputTransactions = normalizeInvocationsPerSpaceOccurence(uploadAddInv)
      if (!updateInputTransactions.length) {
        return
      }

      const transactItems = getItemsToIncrementForMetric(
        updateInputTransactions,
        tableName,
        SPACE_METRICS_NAMES.UPLOAD_ADD_TOTAL
      )

      const cmd = new TransactWriteItemsCommand({
        TransactItems: transactItems
      })

      await dynamoDb.send(cmd)
    },
    /**
     * Increment accumulated count from upload/remove operations.
     *
     * @param {Capabilities} uploadRemoveInv
     */
    incrementUploadRemoveCount: async (uploadRemoveInv) => {
      const updateInputTransactions = normalizeInvocationsPerSpaceOccurence(uploadRemoveInv)
      if (!updateInputTransactions.length) {
        return
      }

      const transactItems = getItemsToIncrementForMetric(
        updateInputTransactions,
        tableName,
        SPACE_METRICS_NAMES.UPLOAD_REMOVE_TOTAL
      )

      const cmd = new TransactWriteItemsCommand({
        TransactItems: transactItems
      })

      await dynamoDb.send(cmd)
    },
    /**
     * Increment accumulated count from store/add operations.
     *
     * @param {Capabilities} storeAddInv
     */
    incrementStoreAddCount: async (storeAddInv) => {
      const updateInputTransactions = normalizeInvocationsPerSpaceOccurence(storeAddInv)
      if (!updateInputTransactions.length) {
        return
      }

      const transactItems = getItemsToIncrementForMetric(
        updateInputTransactions,
        tableName,
        SPACE_METRICS_NAMES.STORE_ADD_TOTAL
      )
      const cmd = new TransactWriteItemsCommand({
        TransactItems: transactItems
      })

      await dynamoDb.send(cmd)
    },
    /**
     * Increment total value from store/add operations.
     *
     * @param {Capabilities} operationsInv
     */
    incrementStoreAddSizeTotal: async (operationsInv) => {
      const updateInputTransactions = normalizeInvocationsPerSpaceSize(operationsInv)
      if (!updateInputTransactions.length) {
        return
      }

      const transactItems = getItemsToIncrementForMetric(
        updateInputTransactions,
        tableName,
        SPACE_METRICS_NAMES.STORE_ADD_SIZE_TOTAL
      )

      const cmd = new TransactWriteItemsCommand({
        TransactItems: transactItems
      })

      await dynamoDb.send(cmd)
    },
    /**
     * Increment accumulated count from store/remove operations.
     *
     * @param {Capabilities} storeRemoveInv
     */
    incrementStoreRemoveCount: async (storeRemoveInv) => {
      const updateInputTransactions = normalizeInvocationsPerSpaceOccurence(storeRemoveInv)
      if (!updateInputTransactions.length) {
        return
      }

      const transactItems = getItemsToIncrementForMetric(
        updateInputTransactions,
        tableName,
        SPACE_METRICS_NAMES.STORE_REMOVE_TOTAL
      )
      const cmd = new TransactWriteItemsCommand({
        TransactItems: transactItems
      })

      await dynamoDb.send(cmd)
    },
    /**
     * Increment total value from store/remove operations.
     *
     * @param {Capabilities} operationsInv
     */
    incrementStoreRemoveSizeTotal: async (operationsInv) => {
      const updateInputTransactions = normalizeInvocationsPerSpaceSize(operationsInv)
      if (!updateInputTransactions.length) {
        return
      }

      const transactItems = getItemsToIncrementForMetric(
        updateInputTransactions,
        tableName,
        SPACE_METRICS_NAMES.STORE_REMOVE_SIZE_TOTAL
      )

      const cmd = new TransactWriteItemsCommand({
        TransactItems: transactItems
      })

      await dynamoDb.send(cmd)
    }
  }

}

/**
 * Get items to increment for metric.
 *
 * @param {UpdateInput[]} items 
 * @param {string} tableName 
 * @param {string} metricName 
 * @returns {import('@aws-sdk/client-dynamodb').TransactWriteItem[]}
 */
function getItemsToIncrementForMetric (items, tableName, metricName) {
  return items.map(item => ({
    Update: {
      TableName: tableName,
      UpdateExpression: `ADD #value :value`,
      ExpressionAttributeNames: {'#value': 'value'},
      ExpressionAttributeValues: {
        ':value': { N: String(item.value) },
      },
      Key: marshall({
        space: item.space,
        name: metricName
      }),
    }
  }))
}

/**
 * Merge same space operations into single one and transform into transaction format
 * We cannot have multiple operations in a TransactWrite with same key, and we
 * decrease the probability of reaching the maximum number of transactions.
 *
 * @param {Capabilities} inv
 * @returns {UpdateInput[]}
 */
function normalizeInvocationsPerSpaceOccurence (inv) {
  const res = inv.reduce((acc, c) => {
    const existing = acc?.find((e) => c.with === e.space)
    if (existing) {
      existing.value += 1
    } else {
      acc.push({
        // @ts-expect-error
        space: c.with,
        value: 1
      })
    }
    return acc
  }, /** @type {UpdateInput[]} */ ([]))

  if (res.length >= MAX_TRANSACT_WRITE_ITEMS) {
    throw new Error(`Attempting to increment space count for more than allowed transactions: ${res.length}`)
  }

  return res
}

/**
 * Merge same space operations into single one and transform into transaction format
 * We cannot have multiple operations in a TransactWrite with same key, and we
 * decrease the probability of reaching the maximum number of transactions.
 *
 * @param {Capabilities} inv
 * @returns {UpdateInput[]}
 */
function normalizeInvocationsPerSpaceSize (inv) {
  const res = inv.reduce((acc, c) => {
    const existing = acc?.find((e) => c.with === e.space)
    if (existing) {
      // @ts-expect-error
      existing.value += c.nb?.size
    } else {
      acc.push({
        // @ts-expect-error
        space: c.with,
        // @ts-expect-error
        value: c.nb.size
      })
    }
    return acc
  }, /** @type {UpdateInput[]} */ ([]))

  if (res.length >= MAX_TRANSACT_WRITE_ITEMS) {
    throw new Error(`Attempting to increment space count for more than allowed transactions: ${res.length}`)
  }

  return res
}
