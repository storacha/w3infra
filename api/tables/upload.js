import {
  DynamoDBClient,
  BatchWriteItemCommand,
  GetItemCommand,
  QueryCommand
} from '@aws-sdk/client-dynamodb'
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb'

// https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/clients/client-dynamodb/classes/batchwriteitemcommand.html
export const BATCH_MAX_SAFE_LIMIT = 25

/**
 * Abstraction layer to handle operations on Upload Table.
 *
 * @param {string} region
 * @param {string} tableName
 * @param {object} [options]
 * @param {string} [options.endpoint]
 * @returns {import('../service/types').UploadTable}
 */
export function createUploadTable (region, tableName, options = {}) {
  const dynamoDb = new DynamoDBClient({
    region,
    endpoint: options.endpoint
  })

  return {
    /**
     * Check if the given data CID is bound to the uploader DID
     *
     * @param {string} uploaderDID
     * @param {string} dataCID
     */
     exists: async (uploaderDID, dataCID) => {
      const cmd = new GetItemCommand({
        TableName: tableName,
        Key: marshall({
          uploaderDID,
          dataCID,
        }),
        AttributesToGet: ['uploaderDID'],
      })
  
      try {
        const response = await dynamoDb.send(cmd)
        return response?.Item !== undefined
      } catch {
        return false
      }
    },
    /**
     * Link an upload to an account
     *
     * @param {string} uploaderDID
     * @param {import('../service/types').UploadItemInput} item
     */
    insert: async (uploaderDID, { dataCID, carCIDs }) => {
      const uploadedAt = new Date().toISOString()

      /** @type {import('../service/types').UploadItemOutput[]} */
      const items = carCIDs.map(carCID => ({
        uploaderDID,
        dataCID,
        carCID,
        uploadedAt
      }))
      // items formatted for dynamodb
      const batchItems = items.map(item => ({
        ...item,
        // add sk property for Dynamo Key uniqueness
        sk: `${item.dataCID}#${item.carCID}`
      }))

      // Batch writes with max safe limit
      while (batchItems.length > 0) {
        const currentBatchItems = batchItems.splice(0, BATCH_MAX_SAFE_LIMIT)
        const cmd = new BatchWriteItemCommand({
          RequestItems: { [tableName]: currentBatchItems.map(item => ({
            PutRequest: {
              Item: marshall(item)
            }
          }))},
        })
        await dynamoDb.send(cmd)
      }
      
      return items
    },
    /**
     * Remove an upload from an account
     *
     * @param {string} uploaderDID
     * @param {string} dataCID
     */
    remove:  async (uploaderDID, dataCID) => {
      let lastEvaluatedKey
      // Iterate through all carCIDs mapped to given uploaderDID
      do {
        // Get first batch of items to remove
        const queryCommand = new QueryCommand({
          TableName: tableName,
          Limit: BATCH_MAX_SAFE_LIMIT,
          ExpressionAttributeValues: {
            ':u': { S: uploaderDID },
            ':d': { S: dataCID }
          },  
          KeyConditionExpression: 'uploaderDID = :u',
          FilterExpression: 'contains (dataCID, :d)',
          ProjectionExpression: 'uploaderDID, sk'
        })
        const queryResponse = await dynamoDb.send(queryCommand)
        // Update cursor if existing
        lastEvaluatedKey = queryResponse.LastEvaluatedKey

        const items = queryResponse.Items?.map(i => unmarshall(i)) || []
        if (items.length === 0) {
          break
        }

        // Batch remove set
        const batchCmd = new BatchWriteItemCommand({
          RequestItems: { [tableName]: items.map(item => ({
            DeleteRequest: {
              Key: marshall(item)
            }
          }))},
        })
      
        await dynamoDb.send(batchCmd)
      } while (lastEvaluatedKey)
    },
    /**
     * List all CARs bound to an account
     *
     * @param {string} uploaderDID
     * @param {import('../service/types').ListOptions} [options]
     */
    list:  async (uploaderDID, options = {}) => {
      const cmd = new QueryCommand({
        TableName: tableName,
        Limit: options.pageSize || 20,
        KeyConditions: {
          uploaderDID: {
            ComparisonOperator: 'EQ',
            AttributeValueList: [{ S: uploaderDID }],
          },
        },
        AttributesToGet: ['dataCID', 'carCID', 'uploadedAt'],
      })
      const response = await dynamoDb.send(cmd)

      /** @type {import('../service/types').UploadItemOutput[]} */
      // @ts-expect-error
      const results = response.Items?.map(i => unmarshall(i)) || []

      // TODO: cursor integrate with capabilities

      return {
        pageSize: results.length,
        results
      }
    },
  }
}
