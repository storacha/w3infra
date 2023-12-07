import {
  DynamoDBClient,
  TransactWriteItemsCommand,
  UpdateItemCommand
} from '@aws-sdk/client-dynamodb'
import { marshall } from '@aws-sdk/util-dynamodb'

/**
 * Abstraction layer to handle operations on metrics table.
 *
 * @param {string} region
 * @param {string} tableName
 * @param {object} [options]
 * @param {string} [options.endpoint]
 */
export function createFilecoinMetricsTable (region, tableName, options = {}) {
  const dynamoDb = new DynamoDBClient({
    region,
    endpoint: options.endpoint,
  })

  return useFilecoinMetricsTable(dynamoDb, tableName)
}

/**
 * @param {DynamoDBClient} dynamoDb
 * @param {string} tableName
 * @returns {import('../types').FilecoinMetricsStore}
 */
export function useFilecoinMetricsTable (dynamoDb, tableName) {
  return {

    /**
     * Increment total value of the metric by n.
     *
     * @param {string} metricName 
     * @param {number} n 
     */
    incrementTotal: async (metricName, n) => {
      const updateCmd = new UpdateItemCommand({
        TableName: tableName,
        UpdateExpression: `ADD #value :value`,
          ExpressionAttributeNames: {'#value': 'value'},
          ExpressionAttributeValues: {
            ':value': { N: String(n) },
          },
        Key: marshall({
          name: metricName
        })
      })

      await dynamoDb.send(updateCmd)
    },
    /**
     * Increment total values of the given metrics.
     *
     * @param {Record<string, number>} metricsToUpdate
     */
    incrementTotals: async (metricsToUpdate) => {
      const transactItems = Object.entries(metricsToUpdate).map(([name, n]) => ({
        Update: {
          TableName: tableName,
          UpdateExpression: `ADD #value :value`,
            ExpressionAttributeNames: {'#value': 'value'},
            ExpressionAttributeValues: {
              ':value': { N: String(n) },
            },
          Key: marshall({
            name
          })
        }
      }))
      
      const cmd = new TransactWriteItemsCommand({
        TransactItems: transactItems
      })

      await dynamoDb.send(cmd)
    }
  }
}
