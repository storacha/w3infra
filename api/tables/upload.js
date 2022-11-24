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
     * @param {string} space
     * @param {string} root
     */
     exists: async (space, root) => {
      const cmd = new GetItemCommand({
        TableName: tableName,
        Key: marshall({
          space,
          root,
        }),
        AttributesToGet: ['space'],
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
     * @param {import('../service/types').UploadItemInput} item
     * @returns {Promise<import('../service/types').UploadItemOutput[]>}
     */
    insert: async ({ space, root, shards = [], agent, ucan }) => {
      const insertedAt = new Date().toISOString()

      /** @type {import('../service/types').UploadItemOutput[]} */
      const items = shards.map(shard => ({
        space,
        root,
        shard,
        agent,
        ucan,
        insertedAt
      }))
      // items formatted for dynamodb
      const batchItems = items.map(item => ({
        ...item,
        // add sk property for Dynamo Key uniqueness
        sk: `${item.root}#${item.shard}`
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
     * @param {string} space
     * @param {string} root
     */
    remove: async (space, root) => {
      let lastEvaluatedKey
      // Iterate through all carCIDs mapped to given space
      do {
        // Get first batch of items to remove
        const queryCommand = new QueryCommand({
          TableName: tableName,
          Limit: BATCH_MAX_SAFE_LIMIT,
          ExpressionAttributeValues: {
            ':u': { S: space },
            ':d': { S: root }
          },
          // gotta sidestep dynamo reserved words!?
          ExpressionAttributeNames: {
            '#space': 'space',
          },
          KeyConditionExpression: '#space = :u',
          FilterExpression: 'contains (root, :d)',
          ProjectionExpression: '#space, sk'
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
     * @param {string} space
     * @param {import('../service/types').ListOptions} [options]
     */
    list:  async (space, options = {}) => {
      const exclusiveStartKey = options.cursor ? marshall({
        space,
        sk: options.cursor
      }) : undefined

      const cmd = new QueryCommand({
        TableName: tableName,
        Limit: options.size || 20,
        KeyConditions: {
          space: {
            ComparisonOperator: 'EQ',
            AttributeValueList: [{ S: space }],
          },
        },
        ExclusiveStartKey: exclusiveStartKey,
        AttributesToGet: ['root', 'shard', 'insertedAt'],
      })
      const response = await dynamoDb.send(cmd)

      /** @type {import('../service/types').UploadItemOutput[]} */
      // @ts-expect-error
      const results = response.Items?.map(i => unmarshall(i)) || []

      // Get cursor of the item where list operation stopped (inclusive).
      // This value can be used to start a new operation to continue listing.
      const lastKey = response.LastEvaluatedKey && unmarshall(response.LastEvaluatedKey)
      const cursor = lastKey ? lastKey.sk : undefined

      return {
        size: results.length,
        results,
        cursor
      }
    },
  }
}
