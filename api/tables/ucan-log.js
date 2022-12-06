import {
  DynamoDBClient,
  PutItemCommand
} from '@aws-sdk/client-dynamodb'
import { marshall } from '@aws-sdk/util-dynamodb'

/** @typedef {import('../service/types').UcanLogInput} UcanLogInput */

/**
 * Abstraction layer to handle operations on UcanLog Table.
 *
 * @param {string} region
 * @param {string} tableName
 * @param {object} [options]
 * @param {string} [options.endpoint]
 * @returns {import('../service/types').UcanLogTable}
 */
export function createUcanLogTable (region, tableName, options = {}) {
  const dynamoDb = new DynamoDBClient({
    region,
    endpoint: options.endpoint
  })

  return {
    /**
     * Add an handled ucan invocation to the log table
     * 
     * @param {UcanLogInput} item
     * @returns {Promise<UcanLogInput>}
     */
    insert: async ({ root, bytes }) => {
      const insertedAt = new Date().toISOString()
      const item = {
        root: root.toString(),
        bytes,
        insertedAt
      }

      const cmd = new PutItemCommand({
        TableName: tableName,
        Item: marshall(item, { removeUndefinedValues: true }),
      })

      await dynamoDb.send(cmd)

      return { root, bytes }
    }
  }
}
