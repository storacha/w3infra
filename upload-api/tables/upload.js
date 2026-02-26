import { trace } from '@opentelemetry/api'
import {
  UpdateItemCommand,
  GetItemCommand,
  DeleteItemCommand,
  QueryCommand,
} from '@aws-sdk/client-dynamodb'
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb'
import { PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3'
import { encode, decode, code as cborCode } from '@ipld/dag-cbor'
import { CID } from 'multiformats/cid'
import { sha256 } from 'multiformats/hashes/sha2'
import { RecordNotFound } from './lib.js'
import { getDynamoClient } from '../../lib/aws/dynamo.js'
import { getS3Client } from '../../lib/aws/s3.js'
import { METRICS_NAMES, SPACE_METRICS_NAMES } from '../constants.js'
import { instrumentMethods } from '../lib/otel/instrument.js'

const tracer = trace.getTracer('upload-api')

// Threshold for storing shards in S3 vs DynamoDB
const SHARD_THRESHOLD = 5000

/**
 * Helper function to get S3 key for shards storage
 *
 * @param {string} space
 * @param {Uint8Array} cborData
 * @returns {Promise<string>}
 */
const getS3Key = async (space, cborData) => {
  const hash = await sha256.digest(cborData)
  const shardsCid = CID.create(1, cborCode, hash)
  return `${space}/${shardsCid.toString()}`
}

/**
 * @import {
 *  UploadTable,
 *  UploadAddSuccess as UploadAddResult,
 *  UploadRemoveSuccess as UploadRemoveResult,
 *  UploadListItem
 * } from '@storacha/upload-api'
 */

/**
 * Abstraction layer to handle operations on Upload Table.
 *
 * @param {string} region
 * @param {string} tableName
 * @param {{
 *   space: import('../types.js').SpaceMetricsStore
 *   admin: import('../types.js').MetricsStore
 * }} metrics
 * @param {object} [options]
 * @param {string} [options.endpoint]
 * @param {string} [options.shardsBucketName]
 * @param {string} [options.shardsBucketRegion]
 * @returns {UploadTable}
 */
export function createUploadTable(region, tableName, metrics, options = {}) {
  const dynamoDb = getDynamoClient({
    region,
    endpoint: options.endpoint,
  })
  const s3Client = getS3Client({
    region: options.shardsBucketRegion ?? region,
  })
  return useUploadTable(dynamoDb, tableName, metrics, {
    s3Client,
    shardsBucketName: options.shardsBucketName,
  })
}

/**
 * @param {import('@aws-sdk/client-dynamodb').DynamoDBClient} dynamoDb
 * @param {string} tableName
 * @param {{
 *   space: import('../types.js').SpaceMetricsStore
 *   admin: import('../types.js').MetricsStore
 * }} metrics
 * @param {object} [options]
 * @param {import('@aws-sdk/client-s3').S3Client} [options.s3Client]
 * @param {string} [options.shardsBucketName]
 * @returns {UploadTable}
 */
export function useUploadTable(dynamoDb, tableName, metrics, options = {}) {
  const { s3Client, shardsBucketName } = options

  /**
   * Helper function to fetch shards from S3 as CID objects
   *
   * @param {string} s3Key
   * @returns {Promise<import('@storacha/upload-api').CARLink[]>}
   */
  const fetchShardsFromS3 = async (s3Key) => {
    if (!s3Client || !shardsBucketName) {
      throw new Error('S3 client not configured for large shard storage')
    }
    const response = await s3Client.send(new GetObjectCommand({
      Bucket: shardsBucketName,
      Key: s3Key,
    }))
    if (!response.Body) {
      throw new Error('No body in S3 response')
    }
    const bytes = await response.Body.transformToByteArray()
    return decode(bytes)
  }

  /**
   * Helper function to fetch shards from S3 as strings
   *
   * @param {string} s3Key
   * @returns {Promise<string[]>}
   */
  const fetchShardStringsFromS3 = async (s3Key) => {
    const shards = await fetchShardsFromS3(s3Key)
    return shards.map(s => s.toString())
  }

  /**
   * Helper function to store shards in S3
   *
   * @param {string} space
   * @param {import('@storacha/upload-api').CARLink[]} shards
   * @returns {Promise<string>} The S3 key where the shards were stored
   */
  const storeShardsInS3 = async (space, shards) => {
    if (!s3Client || !shardsBucketName) {
      throw new Error('S3 client not configured for large shard storage')
    }
    const cborData = encode(shards)
    const s3Key = await getS3Key(space, cborData)

    await s3Client.send(new PutObjectCommand({
      Bucket: shardsBucketName,
      Key: s3Key,
      Body: cborData,
    }))

    return s3Key
  }

  /**
   * Helper function to delete shards from S3
   *
   * @param {string} s3Key
   * @returns {Promise<void>}
   */
  const deleteShardsFromS3 = async (s3Key) => {
    if (!s3Client || !shardsBucketName) {
      return // S3 not configured, nothing to delete
    }
    try {
      await s3Client.send(new DeleteObjectCommand({
        Bucket: shardsBucketName,
        Key: s3Key,
      }))
    } catch (/** @type {any} */ error) {
      // Ignore errors if object doesn't exist
      if (error.name !== 'NoSuchKey') {
        throw error
      }
    }
  }

  return instrumentMethods(tracer, 'UploadTable', {
    /**
     * Fetch a single upload
     *
     * @param {import('@ucanto/interface').DID} space
     * @param {import('@storacha/upload-api').UnknownLink} root
     * @returns {ReturnType<UploadTable['get']>}
     */
    get: async (space, root) => {
      const cmd = new GetItemCommand({
        TableName: tableName,
        Key: marshall({
          space,
          root: root.toString(),
        }),
        AttributesToGet: ['root', 'insertedAt', 'updatedAt'],
      })
      const res = await dynamoDb.send(cmd)
      if (!res.Item) {
        return { error: new RecordNotFound() }
      }
      const item = unmarshall(res.Item)
      return { ok: toUploadListItem(item) }
    },
    /**
     * Check if the given data CID is bound to a space DID
     *
     * @param {import('@ucanto/interface').DID} space
     * @param {import('@storacha/upload-api').UnknownLink} root
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
     * @typedef {import('@storacha/upload-api').UploadAddInput} UploadAddInput
     *
     * @param {UploadAddInput} item
     * @returns {ReturnType<UploadTable['upsert']>}
     */
    upsert: async ({ space, root, shards = [], issuer, cause }) => {
      const insertedAt = new Date().toISOString()

      const Key = {
        space: { S: space.toString() },
        root: { S: root.toString() },
      }

      // First, check if record exists to get existing shards
      /** @type {Map<string, import('@storacha/upload-api').CARLink>} */
      const existingShardsMap = new Map()
      let existingShardsRef = null
      const existingRecord = await dynamoDb.send(
        new GetItemCommand({
          TableName: tableName,
          Key,
          AttributesToGet: ['shards', 'shardsRef'],
        })
      )
      if (existingRecord.Item) {
        const existing = unmarshall(existingRecord.Item)
        if (existing.shardsRef && s3Client && shardsBucketName) {
          // Existing shards are in S3
          existingShardsRef = existing.shardsRef
          const shardsFromS3 = await fetchShardsFromS3(existing.shardsRef)
          for (const shard of shardsFromS3) {
            existingShardsMap.set(shard.toString(), shard)
          }
        } else if (existing.shards) {
          // Existing shards are in DynamoDB (as strings)
          for (const shardStr of existing.shards) {
            // Parse and cast to CARLink (we trust stored data is valid CAR CIDs)
            const shard = /** @type {import('@storacha/upload-api').CARLink} */ (CID.parse(shardStr))
            existingShardsMap.set(shardStr, shard)
          }
        }
      }

      // Merge existing and new shards (use Map for deduplication by CID string)
      for (const shard of shards) {
        existingShardsMap.set(shard.toString(), shard)
      }
      const allShards = Array.from(existingShardsMap.values())
      const totalShardCount = allShards.length

      let UpdateExpression
      /** @type {Record<string, any>} */
      const ExpressionAttributeValues = {
        ':ia': { S: insertedAt },
        ':ua': { S: insertedAt },
        ':ca': { S: cause.toString() },
      }

      // Determine storage strategy based on total shard count
      if (s3Client && shardsBucketName && totalShardCount >= SHARD_THRESHOLD) {
        // Store in S3 with content-addressed key
        const s3Key = await storeShardsInS3(space.toString(), allShards)

        // Update DynamoDB to reference S3, and remove inline shards if they exist
        ExpressionAttributeValues[':ref'] = { S: s3Key }
        UpdateExpression = `SET cause = :ca, insertedAt = if_not_exists(insertedAt, :ia), updatedAt = :ua, shardsRef = :ref REMOVE shards`
      } else {
        // Store inline in DynamoDB
        if (shards.length > 0) {
          ExpressionAttributeValues[':sh'] = { SS: shards.map((s) => s.toString()) }
          const shardExpression = 'ADD shards :sh'
          UpdateExpression = `SET cause = :ca, insertedAt = if_not_exists(insertedAt, :ia), updatedAt = :ua ${shardExpression}`

          // If migrating from S3 to inline (shouldn't happen but handle it), remove shardsRef
          if (existingShardsRef) {
            UpdateExpression += ' REMOVE shardsRef'
          }
        } else {
          UpdateExpression = `SET cause = :ca, insertedAt = if_not_exists(insertedAt, :ia), updatedAt = :ua`
        }
      }

      /**
       * upsert!
       * - Set updatedAt (space & root are set automatically from Key when creating a new item)
       * - Set insertedAt when creating a new entry
       * - Add shards to existing Set OR set shardsRef for S3 storage
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

      const raw = unmarshall(res.Attributes)

      // If shards were stored in S3, use the allShards we just stored (no need to fetch)
      // Convert CID objects to strings to match DynamoDB format
      if (raw.shardsRef) {
        raw.shards = allShards.map(s => s.toString())
      }

      // if new, increment total
      if (raw.insertedAt === raw.updatedAt) {
        await Promise.all([
          metrics.space.incrementTotals({
            [SPACE_METRICS_NAMES.UPLOAD_ADD_TOTAL]: [{ space, value: 1 }]
          }),
          metrics.admin.incrementTotals({
            [METRICS_NAMES.UPLOAD_ADD_TOTAL]: 1,
          })
        ])
      }

      return { ok: toUploadAddResult(raw) }
    },
    /**
     * Remove an upload from an account
     *
     * @param {import('@ucanto/interface').DID} space
     * @param {import('@storacha/upload-api').UnknownLink} root
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

        if (raw.shardsRef && s3Client && shardsBucketName) {
          // Now delete the S3 object
          await deleteShardsFromS3(raw.shardsRef)
        }

        await Promise.all([
          metrics.space.incrementTotals({
            [SPACE_METRICS_NAMES.UPLOAD_REMOVE_TOTAL]: [{ space, value: -1 }]
          }),
          metrics.admin.incrementTotals({
            [METRICS_NAMES.UPLOAD_REMOVE_TOTAL]: 1,
          })
        ])

        return { ok: toUploadRemoveResult(raw) }
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
     * @param {import('@storacha/upload-api').ListOptions} [options]
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
        AttributesToGet: ['root', 'insertedAt', 'updatedAt'],
      })
      const response = await dynamoDb.send(cmd)
      const results = (response.Items ?? []).map(i => toUploadListItem(unmarshall(i)))
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
     * List all shards for an upload.
     *
     * @type {UploadTable['listShards']}
     */
    listShards: async (space, root, options = {}) => {
      const cmd = new GetItemCommand({
        TableName: tableName,
        Key: marshall({
          space,
          root: root.toString(),
        }),
        AttributesToGet: ['root', 'shards', 'shardsRef', 'insertedAt', 'updatedAt'],
      })
      const res = await dynamoDb.send(cmd)
      if (!res.Item) {
        return { error: new RecordNotFound() }
      }
      const upload = unmarshall(res.Item)

      let size = options?.size ?? 1000
      if (typeof size !== 'number' || isNaN(size)) {
        size = 1000
      } else if (size < 1) {
        size = 1
      } else if (size > 1000) {
        size = 1000
      } else {
        size = Math.trunc(size)
      }

      /** @type {string[]} */
      let shards = upload.shards ?? []
      // If shards are stored in S3, fetch them
      if (upload.shardsRef && s3Client && shardsBucketName) {
        try {
          shards = await fetchShardStringsFromS3(upload.shardsRef)
        } catch (/** @type {any} */ error) {
          console.error('Failed to fetch shards from S3:', error)
          return { error }
        }
      }

      let cursorIndex = 0
      if (options?.cursor) {
        cursorIndex = Math.max(0, shards.findIndex(s => s === options.cursor))
      }
      const results = shards.slice(cursorIndex, cursorIndex+size)
      const cursor = shards[cursorIndex+size]

      return {
        ok: {
          size: shards.length,
          cursor,
          results: results.map(r => CID.parse(r)),
        }
      }
    },

    /**
     * Get information about a CID.
     * 
     * @param {import('@storacha/upload-api').UnknownLink} link
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
  })
}

/**
 * Convert from the db representation to an UploadAddResult
 *
 * @param {Record<string, any>} item
 * @returns {UploadAddResult}
 */
export function toUploadAddResult({ root }) {
  return {
    root: CID.parse(root),
  }
}

/**
 * Convert from the db representation to an UploadRemoveResult
 *
 * @param {Record<string, any>} item
 * @returns {UploadRemoveResult}
 */
export function toUploadRemoveResult({ root }) {
  return {
    root: CID.parse(root),
  }
}

/**
 * Convert from the db representation to an UploadListItem
 *
 * @param {Record<string, any>} item
 * @returns {UploadListItem}
 */
export function toUploadListItem({ insertedAt, updatedAt, root }) {
  return {
    root: CID.parse(root),
    insertedAt,
    updatedAt,
  }
}
