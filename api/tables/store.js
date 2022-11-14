import {
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
} from '@aws-sdk/client-dynamodb'
import { marshall } from '@aws-sdk/util-dynamodb'

/**
 * Abstraction layer to handle operations on Store Table.
 *
 * @param {string} region
 * @param {string} tableName
 * @param {object} [options]
 * @param {string} [options.endpoint]
 */
export function createStoreTable (region, tableName, options = {}) {
  const dynamoDb = new DynamoDBClient({
    region,
    endpoint: options.endpoint
  })

  return {
    /**
     * Check if the given link CID is bound to the uploader account
     *
     * @param {string} uploaderDID
     * @param {string} payloadCID
     */
    exists: async (uploaderDID, payloadCID) => {
      const params = {
        TableName: tableName,
        Key: marshall({
          uploaderDID: uploaderDID.toString(),
          payloadCID: payloadCID.toString(),
        }),
        AttributesToGet: ['uploaderDID'],
      }
  
      try {
        const response = await dynamoDb.send(new GetItemCommand(params))
        return response?.Item !== undefined
      } catch {
        return false
      }
    },
    /**
     * Bind a link CID to an account
     *
     * @param {import('../service/types').StoreItemInput} item
     */
    insert: async ({ uploaderDID, link, proof, origin, size = 0 }) => {
      const item = {
        uploaderDID,
        payloadCID: link,
        applicationDID: '',
        origin: origin || '',
        size,
        proof,
        uploadedAt: new Date().toISOString(),
      }
  
      const params = {
        TableName: tableName,
        Item: marshall(item),
      }
  
      await dynamoDb.send(new PutItemCommand(params))
  
      return item
    }
  }
}
