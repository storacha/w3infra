import {
  DynamoDBClient,
  UpdateItemCommand,
  BatchGetItemCommand
} from '@aws-sdk/client-dynamodb'
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb'
import { parseLink } from '@ucanto/core'
import { revocationTableProps } from '../tables/index.js'

/** @typedef {import('@ucanto/interface').UCANLink} UCANLink */

/**
 * Abstraction layer to handle operations on revocations table.
 *
 * @param {string} region
 * @param {string} tableName
 * @param {object} [options]
 * @param {string} [options.endpoint]
 */
export function createRevocationsTable (region, tableName, options = {}) {
  const dynamoDb = new DynamoDBClient({
    region,
    endpoint: options.endpoint,
  })

  return useRevocationsTable(dynamoDb, tableName)
}

const staticRevocationKeys = new Set(Object.keys(revocationTableProps?.fields || {}))

/**
 * @param {DynamoDBClient} dynamoDb
 * @param {string} tableName
 * @returns {import('@web3-storage/upload-api').RevocationsStorage}
 */
export function useRevocationsTable (dynamoDb, tableName) {
  return {
    async addAll (revocations) {
      for (const revocation of revocations) {
        await dynamoDb.send(new UpdateItemCommand({
          TableName: tableName,
          Key: marshall({
            revoke: revocation.revoke.toString(),
          }),
          // When we get a new revocation, this update expression will create a new "column"
          // in the table row that is keyed by "revokeCID". The name of this new column will be
          // the "scopeCID" and the value will be a map containing metadata - currently just the
          // causeCID
          UpdateExpression: 'SET #scope = :scopeMetadata',
          ExpressionAttributeNames: {
            '#scope': revocation.scope.toString()
          },
          ExpressionAttributeValues: marshall({
            ':scopeMetadata': { cause: revocation.cause.toString() },
          })
        }))
      }
      return { ok: {} }
    },

    async getAll (delegationCIDs) {
      // BatchGetItem only supports batches of 100 and return values under 16MB
      // https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_BatchGetItem.html
      // limiting to 100 should be fine for now, and since we don't return much data we should always
      // stay under the 16 MB limit
      if (delegationCIDs.length > 100) {
        throw new Error('checking for more than 100 revocations in a single call is currently not supported')
      }
      const result = await dynamoDb.send(new BatchGetItemCommand({
        RequestItems: {
          [tableName]: {
            Keys: delegationCIDs.map(cid => marshall({ revoke: cid.toString() })),
          }
        }
      }))
      // we need to check various possible error states here - if an error occured
      // should not return true or false, but rather return an error so it
      // can be propagated back to the user
      if (!result.Responses) {
        throw new Error('Did not receive a response from DynamoDB')
      }
      if (result.UnprocessedKeys && (Object.keys(result.UnprocessedKeys).length > 0)) {
        throw new Error('Dynamo did not process all keys')
      }

      const revocations = result.Responses?.[tableName].reduce((m, marshalledItem) => {
        const item = unmarshall(marshalledItem)
        const revokeCID = /** @type {UCANLink} */(parseLink(item.revoke))
        for (const [key, value] of Object.entries(item)) {
          // all values other than those explicitly listed in the schema are assumed
          // to be map values keyed by scopeCID
          if (!staticRevocationKeys.has(key)) {
            const scopeCID = /** @type {UCANLink} */(parseLink(key))
            const causeCID = /** @type {UCANLink} */(parseLink(value.cause))
            m.push({
              revoke: revokeCID,
              scope: scopeCID,
              cause: causeCID
            })
          }
        }
        return m
      }, /** @type {import('@web3-storage/upload-api').Revocation[]} */([]))
      return { ok: revocations }
    }
  }
}
