import {
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
  DeleteItemCommand,
  QueryCommand
} from '@aws-sdk/client-dynamodb'
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb'

/**
 * Abstraction layer to handle operations on Store Table.
 *
 * @param {string} region
 * @param {string} tableName
 * @param {object} [options]
 * @param {string} [options.endpoint]
 * @returns {import('../service/types').StoreTable}
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
          uploaderDID,
          payloadCID,
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
    },
    /**
     * Unbinds a link CID to an account
     *
     * @param {string} uploaderDID
     * @param {string} payloadCID
     */
    remove: async (uploaderDID, payloadCID) => {
      const cmd = new DeleteItemCommand({
        TableName: tableName,
        Key: marshall({
          uploaderDID,
          payloadCID,
        })
      })
  
      await dynamoDb.send(cmd)
    },
    /**
     * List all CARs bound to an account
     *
     * @param {string} uploaderDID
     * @param {import('../service/types').ListOptions} [options]
     */
    list: async (uploaderDID, options = {}) => {
      const cmd = new QueryCommand({
        TableName: tableName,
        Limit: options.pageSize || 20,
        KeyConditions: {
          uploaderDID: {
            ComparisonOperator: 'EQ',
            AttributeValueList: [{ S: uploaderDID }],
          },
        },
        AttributesToGet: ['payloadCID', 'size', 'origin', 'uploadedAt'],
      })
      const response = await dynamoDb.send(cmd)

      /** @type {import('../service/types').StoreListResult[]} */
      // @ts-expect-error
      const results = response.Items?.map(i => unmarshall(i)) || []

      /* 
      // TODO: cursor integrate with capabilities
      // Get cursor of last key payload CID
      const lastKey = response.LastEvaluatedKey && unmarshall(response.LastEvaluatedKey)
      const cursorID = lastKey ? lastKey.payloadCID : undefined
      */

      return {
        pageSize: results.length,
        // cursorID,
        results
      }
    }
  }
}
