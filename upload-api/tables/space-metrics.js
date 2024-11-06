import { GetItemCommand } from '@aws-sdk/client-dynamodb'
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb'
import { METRICS_NAMES } from '../constants.js'
import { getDynamoClient } from '../../lib/aws/dynamo.js'


/**
 * Abstraction layer to handle operations on space metrics Table.
 *
 * @param {string} region
 * @param {string} tableName
 * @param {object} [options]
 * @param {string} [options.endpoint]
 */
export function createSpaceMetricsTable(region, tableName, options = {}) {
  const dynamoDb = getDynamoClient({
    region,
    endpoint: options.endpoint
  })

  return useSpaceMetricsTable(dynamoDb, tableName)
}

/**
 * @param {import('@aws-sdk/client-dynamodb').DynamoDBClient} dynamoDb
 * @param {string} tableName
 * @returns {import('../types').SpaceMetricsTable}
 */
export function useSpaceMetricsTable(dynamoDb, tableName) {
  /**
   * @param {string} name
   * @param {import('@storacha/access').SpaceDID} space
   */
  const getMetric = async (name, space) => {
    const response = await dynamoDb.send(new GetItemCommand({
      TableName: tableName,
      Key: marshall({ space, name })
    }))
    return Number(response.Item ? unmarshall(response.Item).value : 0)
  }
  return {
    /**
     * Return the total amount of storage a space has used.
     * 
     * @param {import('@ucanto/interface').DIDKey} consumer the space whose current allocation we should return
     */
    getAllocated: async (consumer) => {
      const [addedBytes, removedBytes] = await Promise.all([
        getMetric(METRICS_NAMES.BLOB_ADD_SIZE_TOTAL, consumer),
        getMetric(METRICS_NAMES.BLOB_REMOVE_SIZE_TOTAL, consumer)
      ])
      return Math.max(0, addedBytes - removedBytes)
    }
  }
}
