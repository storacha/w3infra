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
     * @param {import('@ucanto/interface').DID} space
     * @param {import('../service/types').AnyLink} link
     */
    exists: async (space, link) => {
      const cmd = new GetItemCommand({
        TableName: tableName,
        Key: marshall({
          space,
          link: link.toString()
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
     * Bind a link CID to an account
     *
     * @typedef {import('../service/types').StoreItemOutput} StoreItemOutput
     * 
     * @param {import('../service/types').StoreItemInput} item
     * @returns {Promise<StoreItemOutput>}
     */
    insert: async ({ space, link, origin, size = 0, issuer, invocation }) => {
      /** @type StoreItemOutput */
      const item = {
        space,
        link: link.toString(),
        size,
        origin: origin?.toString(),
        issuer,
        invocation: invocation.toString(),
        insertedAt: new Date().toISOString(),
      }

      const cmd = new PutItemCommand({
        TableName: tableName,
        Item: marshall(item, { removeUndefinedValues: true }),
      })

      await dynamoDb.send(cmd)

      return item
    },
    /**
     * Unbinds a link CID to an account
     *
     * @param {import('@ucanto/interface').DID} space
     * @param {import('../service/types').AnyLink} link
     */
    remove: async (space, link) => {
      const cmd = new DeleteItemCommand({
        TableName: tableName,
        Key: marshall({
          space,
          link: link.toString(),
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
     * @param {import('@ucanto/interface').DID} space
     * @param {import('../service/types').ListOptions} [options]
     * @returns {Promise<ListResponse>}
     */
    list: async (space, options = {}) => {
      const exclusiveStartKey = options.cursor ? marshall({
        space,
        link: options.cursor
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
        AttributesToGet: ['link', 'size', 'origin', 'insertedAt'],
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
      const cursor = lastKey ? lastKey.link : undefined

      return {
        size: results.length,
        cursor,
        results
      }
    }
  }
}
