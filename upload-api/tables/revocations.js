import {
  DynamoDBClient,
  UpdateItemCommand,
  BatchGetItemCommand
} from '@aws-sdk/client-dynamodb'
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb'
import { parseLink } from '@ucanto/core'

/**
 * Abstraction layer to handle operations on revocations table.
 *
 * @param {string} region
 * @param {string} tableName
 * @param {object} [options]
 * @param {string} [options.endpoint]
 */
export function createRevocationsTable(region, tableName, options = {}) {
  const dynamoDb = new DynamoDBClient({
    region,
    endpoint: options.endpoint,
  })

  return useRevocationsTable(dynamoDb, tableName)
}

/**
 * @param {DynamoDBClient} dynamoDb
 * @param {string} tableName
 * @returns {import('../types').RevocationsTable}
 */
export function useRevocationsTable(dynamoDb, tableName) {
  return {
    async put (delegationCID, contextCID, causeCID) {
      await dynamoDb.send(new UpdateItemCommand({
        TableName: tableName,
        Key: marshall({
          delegation: delegationCID.toString(),
        }),
        UpdateExpression: 'ADD contextsAndCauses :candc',
        ExpressionAttributeValues: marshall({
          ':candc': new Set([`${contextCID.toString()}:${causeCID.toString()}`])
        })
      }))
    },

    async getRevocations(delegationCIDs) {
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
            Keys: delegationCIDs.map(cid => marshall({ delegation: cid.toString() })),
            ProjectionExpression: 'contextsAndCauses'
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

      return delegationCIDs.reduce((m, delegationCID, i) => {
        const res = result.Responses?.[tableName][i]
        if (res) {
          m[/** @type {string} */(delegationCID.toString())] = Array.from(unmarshall(res).contextsAndCauses).map(candc => {
            const [context, cause] = candc.split(":")
            return {
              context: parseLink(context),
              cause: parseLink(cause)
            }
          })
        }
        return m
      }, /** @type {import('@web3-storage/upload-api').RevocationsToMeta} */({}))
    }
  }
}
