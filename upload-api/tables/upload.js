import {
  UpdateItemCommand,
  GetItemCommand,
  DeleteItemCommand,
  QueryCommand,
} from '@aws-sdk/client-dynamodb'
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb'
import { CID } from 'multiformats/cid'
import { RecordNotFound } from './lib.js'
import { getDynamoClient } from '../../lib/aws/dynamo.js'

/**
 * @typedef {import('@web3-storage/upload-api').UploadTable} UploadTable
 * @typedef {import('@web3-storage/upload-api').UploadAddSuccess} UploadAddResult
 * @typedef {import('@web3-storage/upload-api').UploadListItem} UploadListItem
 */

/**
 * Abstraction layer to handle operations on Upload Table.
 *
 * @param {string} region
 * @param {string} tableName
 * @param {object} [options]
 * @param {string} [options.endpoint]
 * @returns {UploadTable}
 */
export function createUploadTable(region, tableName, options = {}) {
  const dynamoDb = getDynamoClient({
    region,
    endpoint: options.endpoint,
  })
  return useUploadTable(dynamoDb, tableName)
}

/**
 * @param {import('@aws-sdk/client-dynamodb').DynamoDBClient} dynamoDb
 * @param {string} tableName
 * @returns {UploadTable}
 */
export function useUploadTable(dynamoDb, tableName) {
  return {
    /**
     * Fetch a single upload
     *
     * @param {import('@ucanto/interface').DID} space
     * @param {import('@web3-storage/upload-api').UnknownLink} root
     * @returns {ReturnType<UploadTable['get']>}
     */
    get: async (space, root) => {
      const cmd = new GetItemCommand({
        TableName: tableName,
        Key: marshall({
          space,
          root: root.toString(),
        }),
        AttributesToGet: ['space', 'root', 'shards', 'insertedAt', 'updatedAt'],
      })
      const res = await dynamoDb.send(cmd)
      if (!res.Item) {
        return { error: new RecordNotFound() }
      }
      return { ok: toUploadListItem(unmarshall(res.Item)) }
    },
    /**
     * Check if the given data CID is bound to a space DID
     *
     * @param {import('@ucanto/interface').DID} space
     * @param {import('@web3-storage/upload-api').UnknownLink} root
     * @returns {ReturnType<UploadTable['exists']>}
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
        return { ok: Boolean(response.Item) }
      } catch {
        return { ok: false }
      }
    },
    /**
     * Link a root data CID to a car CID shard in a space DID.
     *
     * @typedef {import('@web3-storage/upload-api').UploadAddInput} UploadAddInput
     *
     * @param {UploadAddInput} item
     * @returns {ReturnType<UploadTable['upsert']>}
     */
    upsert: async ({ space, root, shards = [], issuer, invocation }) => {
      const insertedAt = new Date().toISOString()
      const shardSet = new Set(shards.map((s) => s.toString()))

      const Key = {
        space: { S: space.toString() },
        root: { S: root.toString() },
      }

      // dynamo wont let us store an empty Set. We have to adjust the expression to only ADD it if it exists.
      const ExpressionAttributeValues = {
        ':ia': { S: insertedAt },
        ':ua': { S: insertedAt },
        ...(shardSet.size > 0 && {
          ':sh': { SS: [...shardSet] }, // SS is "String Set"
        }),
      }

      const shardExpression = shards.length ? 'ADD shards :sh' : ''
      const UpdateExpression = `SET insertedAt=if_not_exists(insertedAt, :ia), updatedAt = :ua ${shardExpression}`

      /**
       * upsert!
       * - Set updatedAt (space & root are set automatically from Key when creating a new item)
       * - Set insertedAt when creating a new entry
       * - Add shards to existing Set.
       */
      const res = await dynamoDb.send(
        new UpdateItemCommand({
          TableName: tableName,
          Key,
          UpdateExpression,
          ExpressionAttributeValues,
          ReturnValues: 'ALL_NEW',
        })
      )

      if (!res.Attributes) {
        throw new Error('Missing `Attributes` property on DynamoDB response')
      }

      return { ok: toUploadAddResult(unmarshall(res.Attributes)) }
    },
    /**
     * Remove an upload from an account
     *
     * @param {import('@ucanto/interface').DID} space
     * @param {import('@web3-storage/upload-api').UnknownLink} root
     * @returns {ReturnType<UploadTable['remove']>}
     */
    remove: async (space, root) => {
      const cmd = new DeleteItemCommand({
        TableName: tableName,
        Key: marshall({
          space,
          root: root.toString(),
        }),
        ConditionExpression: 'attribute_exists(#S) AND attribute_exists(#R)',
        ExpressionAttributeNames: { '#S': 'space', '#R': 'root' },
        ReturnValues: 'ALL_OLD',
      })
      try {
        // return the removed object so caller may remove all shards
        const res = await dynamoDb.send(cmd)
        if (res.Attributes === undefined) {
          throw new Error('missing return values')
        }
        const raw = unmarshall(res.Attributes)
        return { ok: toUploadAddResult(raw) }
      } catch (/** @type {any} */ err) {
        if (err.name === 'ConditionalCheckFailedException') {
          return { error: new RecordNotFound() }
        }
        throw err
      }
    },
    /**
     * List all CARs bound to an account
     *
     * @param {string} space
     * @param {import('@web3-storage/upload-api').ListOptions} [options]
     * @returns {ReturnType<UploadTable['list']>}
     */
    list: async (space, options = {}) => {
      const exclusiveStartKey = options.cursor
        ? marshall({
            space,
            root: options.cursor,
          })
        : undefined

      const cmd = new QueryCommand({
        TableName: tableName,
        Limit: options.size || 20,
        KeyConditions: {
          space: {
            ComparisonOperator: 'EQ',
            AttributeValueList: [{ S: space }],
          },
        },
        ScanIndexForward: !options.pre,
        ExclusiveStartKey: exclusiveStartKey,
        AttributesToGet: ['space', 'root', 'shards', 'insertedAt', 'updatedAt'],
      })
      const response = await dynamoDb.send(cmd)

      const results = (response.Items ?? []).map((i) => toUploadListItem(unmarshall(i)))
      const firstRootCID = results[0] ? results[0].root.toString() : undefined

      // Get cursor of the item where list operation stopped (inclusive).
      // This value can be used to start a new operation to continue listing.
      const lastKey =
        response.LastEvaluatedKey && unmarshall(response.LastEvaluatedKey)
      const lastRootCID = lastKey ? lastKey.root : undefined

      const before = options.pre ? lastRootCID : firstRootCID
      const after = options.pre ? firstRootCID : lastRootCID
      return {
        ok: {
          size: results.length,
          before,
          after,
          cursor: after,
          results: options.pre ? results.reverse() : results,
        }
      }
    },

    /**
     * Get information about a CID.
     * 
     * @param {import('@web3-storage/upload-api').UnknownLink} link
     * @returns {ReturnType<UploadTable['inspect']>}
     */
    inspect: async (link) => {
      const response = await dynamoDb.send(new QueryCommand({
        TableName: tableName,
        IndexName: 'cid',
        KeyConditionExpression: "root = :root",
        ExpressionAttributeValues: {
          ':root': { S: link.toString() }
        }
      }))
      return {
        ok: {
          spaces: (response.Items ?? []).map(i => {
            const item = unmarshall(i)
            return ({
              did: item.space,
              insertedAt: item.insertedAt
            })
          })
        }
      }
    }
  }
}

/**
 * Convert from the db representation to an UploadAddInput
 *
 * @param {Record<string, any>} item
 * @returns {UploadAddResult}
 */
export function toUploadAddResult({ root, shards }) {
  return {
    root: CID.parse(root),
    shards: (shards ? [...shards] : []).map((s) => /** @type {import('@web3-storage/upload-api').CARLink} */ (CID.parse(s))),
  }
}

/**
 * Convert from the db representation to an UploadListItem
 *
 * @param {Record<string, any>} item
 * @returns {UploadListItem & { insertedAt: string; updatedAt: string }}
 */
export function toUploadListItem({ insertedAt, updatedAt, ...rest }) {
  return {
    ...toUploadAddResult(rest),
    insertedAt,
    updatedAt,
  }
}
