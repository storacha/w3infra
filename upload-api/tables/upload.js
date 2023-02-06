import {
  DynamoDBClient,
  UpdateItemCommand,
  GetItemCommand,
  DeleteItemCommand,
  QueryCommand
} from '@aws-sdk/client-dynamodb'
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb'
import { CID } from 'multiformats/cid'

/** @typedef {import('../service/types').UploadAddResult} UploadAddResult */
/** @typedef {import('../service/types').UploadListItem} UploadListItem */

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
     * Check if the given data CID is bound to a space DID
     *
     * @param {import('@ucanto/interface').DID} space
     * @param {import('../service/types').AnyLink} root
     */
     exists: async (space, root) => {
      const cmd = new GetItemCommand({
        TableName: tableName,
        Key: marshall({
          space,
          root: root.toString(),
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
     * Link a root data CID to a car CID shard in a space DID.
     * 
     * @typedef {import('../service/types').UploadAddInput} UploadAddInput
     *
     * @param {UploadAddInput} item
     * @returns {Promise<UploadAddResult>}
     */
    insert: async ({ space, root, shards = [], issuer, invocation }) => {
      const insertedAt = new Date().toISOString()
      const shardSet = new Set(shards.map(s => s.toString()))

      const Key = {
        space: { S: space.toString() },
        root: { S: root.toString() }
      }

      // dynamo wont let us store an empty Set. We have to adjust the expression to only ADD it if it exists.
      const ExpressionAttributeValues = {
        ':ia': { S: insertedAt },
        ':ua': { S: insertedAt },
        ...shardSet.size > 0 && {
          ':sh' :{ SS: [...shardSet] } // SS is "String Set"
        },
      }

      const shardExpression = shards.length ? 'ADD shards :sh' : ''
      const UpdateExpression = `SET insertedAt=if_not_exists(insertedAt, :ia), updatedAt = :ua ${shardExpression}`

      /**
       * upsert! 
       * - Set updatedAt (space & root are set automatically from Key when creating a new item)
       * - Set insertedAt when creating a new entry
       * - Add shards to existing Set.
       */
      const res = await dynamoDb.send(new UpdateItemCommand({
        TableName: tableName,
        Key,
        UpdateExpression,
        ExpressionAttributeValues,
        ReturnValues: 'ALL_NEW'
      }))

      if (!res.Attributes) {
        throw new Error('Missing `Attributes` property on DyanmoDB response')
      }

      return toUploadAddResult(unmarshall(res.Attributes))
    },
    /**
     * Remove an upload from an account
     *
     * @param {import('@ucanto/interface').DID} space
     * @param {import('../service/types').AnyLink} root
     */
    remove: async (space, root) => {
      const cmd = new DeleteItemCommand({
        TableName: tableName,
        Key: marshall({
          space,
          root: root.toString(),
        }),
        ReturnValues: 'ALL_OLD'
      })
      // return the removed object so caller may remove all shards
      const res = await dynamoDb.send(cmd)
      if (res.Attributes === undefined) {
        return
      }
      const raw = unmarshall(res.Attributes)
      return toUploadAddResult(raw)
    },
    /**
     * List all CARs bound to an account
     *
     * @param {string} space
     * @param {import('../service/types').ListOptions} [options]
     */
    list: async (space, options = {}) => {
      const exclusiveStartKey = options.cursor ? marshall({
        space,
        root: options.cursor
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
        ScanIndexForward: options.prev ? false : true,
        ExclusiveStartKey: exclusiveStartKey,
        AttributesToGet: ['space', 'root', 'shards', 'insertedAt', 'updatedAt'],
      })
      const response = await dynamoDb.send(cmd)

      /** @type {UploadListItem[]} */
      const results = response.Items?.map(i => toUploadListItem(unmarshall(i))) || []

      // Get cursor of the item where list operation stopped (inclusive).
      // This value can be used to start a new operation to continue listing.
      const lastKey = response.LastEvaluatedKey && unmarshall(response.LastEvaluatedKey)
      const cursor = lastKey ? lastKey.root : undefined

      return {
        size: results.length,
        results,
        cursor
      }
    },
  }
}

/**
 * Convert from the db representation to an UploadAddInput
 * 
 * @param {Record<string, any>} item
 * @returns {UploadAddResult}
 */
 export function toUploadAddResult ({root, shards}) {
  return {
    root: CID.parse(root),
    shards: (shards ? [...shards] : []).map(s => CID.parse(s))
  }
}

/**
 * Convert from the db representation to an UploadListItem
 * 
 * @param {Record<string, any>} item
 * @returns {UploadListItem}
 */
export function toUploadListItem ({insertedAt, updatedAt, ...rest}) {
  return {
    ...toUploadAddResult(rest),
    insertedAt,
    updatedAt
  }
}