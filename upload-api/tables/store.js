import {
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
  DeleteItemCommand,
  QueryCommand,
} from '@aws-sdk/client-dynamodb'
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb'
import { CID } from 'multiformats/cid'
import * as Link from 'multiformats/link'

/** @typedef {import('@web3-storage/upload-api').StoreAddInput} StoreAddInput */
/** @typedef {import('@web3-storage/upload-api').StoreAddOutput} StoreAddOutput */
/** @typedef {import('@web3-storage/upload-api').StoreListItem} StoreListItem */

/**
 * Abstraction layer to handle operations on Store Table.
 *
 * @param {string} region
 * @param {string} tableName
 * @param {object} [options]
 * @param {string} [options.endpoint]
 */
export function createStoreTable(region, tableName, options = {}) {
  const dynamoDb = new DynamoDBClient({
    region,
    endpoint: options.endpoint,
  })

  return useStoreTable(dynamoDb, tableName)
}

/**
 * @param {DynamoDBClient} dynamoDb
 * @param {string} tableName
 * @returns {import('@web3-storage/upload-api').StoreTable & import('@web3-storage/upload-api').TestStoreTable}
 */

export function useStoreTable(dynamoDb, tableName) {
  return {
    /**
     * Check if the given link CID is bound to the uploader account
     *
     * @param {import('@ucanto/interface').DID} space
     * @param {import('@web3-storage/upload-api').UnknownLink} link
     */
    exists: async (space, link) => {
      const cmd = new GetItemCommand({
        TableName: tableName,
        Key: marshall({
          space,
          link: link.toString(),
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
     * @param {StoreAddInput} item
     * @returns {Promise<StoreAddOutput>}
     */
    insert: async ({ space, link, origin, size, issuer, invocation }) => {
      const insertedAt = new Date().toISOString()

      const item = {
        space,
        link: link.toString(),
        size,
        origin: origin?.toString(),
        issuer,
        invocation: invocation.toString(),
        insertedAt,
      }

      const cmd = new PutItemCommand({
        TableName: tableName,
        Item: marshall(item, { removeUndefinedValues: true }),
      })

      await dynamoDb.send(cmd)
      return { link, size, ...(origin && { origin }) }
    },
    /**
     * Unbinds a link CID to an account
     *
     * @param {import('@ucanto/interface').DID} space
     * @param {import('@web3-storage/upload-api').UnknownLink} link
     */
    remove: async (space, link) => {
      const cmd = new DeleteItemCommand({
        TableName: tableName,
        Key: marshall({
          space,
          link: link.toString(),
        }),
      })

      await dynamoDb.send(cmd)
    },
    /**
     * List all CARs bound to an account
     *
     * @typedef {import('@web3-storage/upload-api').ListResponse<StoreListItem>} ListResponse
     *
     * @param {import('@ucanto/interface').DID} space
     * @param {import('@web3-storage/upload-api').ListOptions} [options]
     * @returns {Promise<ListResponse>}
     */
    list: async (space, options = {}) => {
      const exclusiveStartKey = options.cursor
        ? marshall({
            space,
            link: options.cursor,
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
        AttributesToGet: ['link', 'size', 'origin', 'insertedAt'],
      })
      const response = await dynamoDb.send(cmd)

      const results =
        response.Items?.map((i) => toStoreListResult(unmarshall(i))) ?? []
      const firstLinkCID = results[0] ? results[0].link.toString() : undefined
      // Get cursor of the item where list operation stopped (inclusive).
      // This value can be used to start a new operation to continue listing.
      const lastKey =
        response.LastEvaluatedKey && unmarshall(response.LastEvaluatedKey)
      const lastLinkCID = lastKey ? lastKey.link : undefined

      const before = options.pre ? lastLinkCID : firstLinkCID
      const after = options.pre ? firstLinkCID : lastLinkCID
      return {
        size: results.length,
        before,
        after: after,
        cursor: after,
        results: options.pre ? results.reverse() : results,
      }
    },
    /**
     * @param {import('@web3-storage/upload-api').DID} space
     * @param {import('@web3-storage/upload-api').UnknownLink} link
     */
    async get(space, link) {
      const item = {
        space,
        link: link.toString(),
      }

      const params = {
        TableName: tableName,
        Key: marshall(item),
      }

      const response = await dynamoDb.send(new GetItemCommand(params))
      if (response?.Item) {
        const { space, link, size, origin, issuer, invocation, insertedAt } =
          unmarshall(response?.Item)

        return {
          space,
          link: Link.parse(link),
          size: Number(size),
          ...(origin ? { origin: Link.parse(origin) } : {}),
          issuer,
          invocation: Link.parse(invocation),
          insertedAt,
        }
      }
    },
  }
}

/**
 * Upgrade from the db representation
 *
 * @param {Record<string, any>} item
 * @returns {StoreListItem}
 */
export function toStoreListResult({ link, size, origin, insertedAt }) {
  return {
    link: CID.parse(link),
    size,
    insertedAt,
    ...(origin && {
      origin: CID.parse(origin),
    }),
  }
}
