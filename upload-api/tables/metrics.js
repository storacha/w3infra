import { trace } from '@opentelemetry/api'
import { ScanCommand } from '@aws-sdk/client-dynamodb'
import { unmarshall } from '@aws-sdk/util-dynamodb'
import { getDynamoClient } from '../../lib/aws/dynamo.js'
import { instrumentMethods } from '../lib/otel/instrument.js'

const tracer = trace.getTracer('upload-api')

/**
 * Abstraction layer to handle operations on admin metrics Table.
 *
 * @param {string} region
 * @param {string} tableName
 * @param {object} [options]
 * @param {string} [options.endpoint]
 */
export function createMetricsTable(region, tableName, options = {}) {
  const dynamoDb = getDynamoClient({
    region,
    endpoint: options.endpoint
  })

  return useMetricsTable(dynamoDb, tableName)
}

/**
 * @param {import('@aws-sdk/client-dynamodb').DynamoDBClient} dynamoDb
 * @param {string} tableName
 * @returns {import('../types.js').MetricsTable}
 */
export function useMetricsTable(dynamoDb, tableName) {
  return instrumentMethods(tracer, 'MetricsTable', {
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
  })
}
