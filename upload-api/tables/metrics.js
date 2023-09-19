import {
  DynamoDBClient,
  ScanCommand
} from '@aws-sdk/client-dynamodb'
import { unmarshall } from '@aws-sdk/util-dynamodb'

/**
 * Abstraction layer to handle operations on admin metrics Table.
 *
 * @param {string} region
 * @param {string} tableName
 * @param {object} [options]
 * @param {string} [options.endpoint]
 */
export function createMetricsTable(region, tableName, options = {}) {
  const dynamoDb = new DynamoDBClient({
    region,
    endpoint: options.endpoint
  })

  return useMetricsTable(dynamoDb, tableName)
}

/**
 * @param {DynamoDBClient} dynamoDb
 * @param {string} tableName
 * @returns {import('../types').MetricsTable}
 */
export function useMetricsTable(dynamoDb, tableName) {
  return {
    /**
     * Get all metrics from table.
     */
    get: async () => {
      const updateCmd = new ScanCommand({
        TableName: tableName,
      })

      const response = await dynamoDb.send(updateCmd)
      return response.Items?.map(i => unmarshall(i)) || []
    }
  }
}
