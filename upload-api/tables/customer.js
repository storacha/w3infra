import {
  DynamoDBClient,
  GetItemCommand,
} from '@aws-sdk/client-dynamodb'
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb'

/**
 * @typedef {import('../types').CustomerTable} CustomerTable
 */

/**
 * Abstraction layer to handle operations on Store Table.
 *
 * @param {string} region
 * @param {string} tableName
 * @param {object} [options]
 * @param {string} [options.endpoint]
 */
export function createCustomerTable(region, tableName, options = {}) {
  const dynamoDb = new DynamoDBClient({
    region,
    endpoint: options.endpoint,
  })

  return useCustomerTable(dynamoDb, tableName)
}

/**
 * @param {DynamoDBClient} dynamoDb
 * @param {string} tableName
 * @returns {CustomerTable}
 */
export function useCustomerTable(dynamoDb, tableName) {
  return {
    /**
     * Get the customer record by mailto DID.
     * 
     * @param {import('@ucanto/interface').DID<'mailto'>} customer
     */
    get: async (customer) => {
      const response = await dynamoDb.send(new GetItemCommand({
        TableName: tableName,
        Key: marshall({ customer })
      }))
      if (response.Item) {
        const item = unmarshall(response.Item)
        return {
          ok: {
            product: item.product,
            updatedAt: item.updatedAt
          }
        }
      } else {
        return {
          error: {
            name: 'RecordNotFound',
            key: customer,
            message: `Could not find a customer record for ${customer}`
          }
        }
      }
    }
  }
}