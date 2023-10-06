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
export function createRevocationsTable (region, tableName, options = {}) {
  const dynamoDb = new DynamoDBClient({
    region,
    endpoint: options.endpoint,
  })

  return useRevocationsTable(dynamoDb, tableName)
}

/**
 * @param {DynamoDBClient} dynamoDb
 * @param {string} tableName
 * @returns {import('@web3-storage/upload-api').RevocationsStorage}
 */
export function useRevocationsTable(dynamoDb, tableName) {
  return {
    async addAll(revocations) {
      for (const revocation of revocations) {
        await dynamoDb.send(new UpdateItemCommand({
          TableName: tableName,
          Key: marshall({
            revoke: revocation.revoke.toString(),
          }),
          // when we add or update this item, use the update expression to 
          // add a string to the "details" set that contains revokeCID and
          // causeCID in a :-separated string
          // see https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Expressions.UpdateExpressions.html
          // for more information about update expressions
          UpdateExpression: 'ADD details :details',
          ExpressionAttributeValues: marshall({
            ':details': new Set([`${revocation.scope.toString()}:${revocation.cause.toString()}`])
          })
        }))
      }
      return { ok: {} }
    },

    async getAll(delegationCIDs) {
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
            ProjectionExpression: 'details'
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

      const revocations = delegationCIDs.reduce(
        (/** @type {import('@web3-storage/upload-api').Revocation[]} */m,
          delegationCID,
          i) => {
          const res = result.Responses?.[tableName][i]
          if (res) {
            for (const scopeAndCause of unmarshall(res).details) {
              const [context, cause] = scopeAndCause.split(":")
              m.push({
                revoke: delegationCID,
                scope: parseLink(context),
                cause: parseLink(cause)
              })
            }
          }
          return m
        }, [])
      return { ok: revocations }
    }
  }
}
