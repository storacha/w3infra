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
     * @param {string} space
     * @param {string} car
     */
    exists: async (space, car) => {
      const cmd = new GetItemCommand({
        TableName: tableName,
        Key: marshall({
          space,
          car
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
     * Bind a link CID to an account
     *
     * @param {import('../service/types').StoreItemInput} item
     * @returns {Promise<import('../service/types').StoreItemOutput>}
     */
    insert: async ({ space, car, origin = '', size = 0, agent, ucan }) => {
      /** @type import('../service/types').StoreItemOutput */
      const item = {
        space,
        car,
        size,
        origin,
        agent,
        ucan,
        insertedAt: new Date().toISOString(),
      }

      const cmd = new PutItemCommand({
        TableName: tableName,
        Item: marshall(item),
      })

      await dynamoDb.send(cmd)

      return item
    },
    /**
     * Unbinds a link CID to an account
     *
     * @param {string} space
     * @param {string} car
     */
    remove: async (space, car) => {
      const cmd = new DeleteItemCommand({
        TableName: tableName,
        Key: marshall({
          space,
          car,
        })
      })
  
      await dynamoDb.send(cmd)
    },
    /**
     * List all CARs bound to an account
     * 
     * @typedef {import('../service/types').StoreListResult} StoreListResult
     * @typedef {import('../service/types').ListResponse<StoreListResult>} ListResponse
     * 
     * @param {string} space
     * @param {import('../service/types').ListOptions} [options]
     * @returns {Promise<ListResponse>}
     */
    list: async (space, options = {}) => {
      const exclusiveStartKey = options.cursor ? marshall({
        space,
        car: options.cursor
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
        AttributesToGet: ['car', 'size', 'origin', 'insertedAt'],
      })
      const response = await dynamoDb.send(cmd)

      /** @type {import('../service/types').StoreListResult[]} */
      // @ts-expect-error
      const results = response.Items?.map(i => {
        const item = unmarshall(i)
        // omit origin if empty
        if (!item.origin) {
          delete item.origin
        }

        return item
      }) || []

      // Get cursor of the item where list operation stopped (inclusive).
      // This value can be used to start a new operation to continue listing.
      const lastKey = response.LastEvaluatedKey && unmarshall(response.LastEvaluatedKey)
      const cursor = lastKey ? lastKey.car : undefined

      return {
        size: results.length,
        cursor,
        results
      }
    }
  }
}
