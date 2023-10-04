import {
  DynamoDBClient,
  PutItemCommand,
  BatchGetItemCommand
} from '@aws-sdk/client-dynamodb'
import { marshall } from '@aws-sdk/util-dynamodb'

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
    async put (invocationCID, revocationCID) {
      await dynamoDb.send(new PutItemCommand({
        TableName: tableName,
        Item: marshall({
          invocation: invocationCID.toString(),
          revocation: revocationCID.toString(),
          insertedAt: new Date().toISOString()
        })
      }))
    },

    async hasAny(invocationCIDs) {
      // BatchGetItem only supports batches of 100 and return values under 16MB
      // https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_BatchGetItem.html
      // limiting to 100 should be fine for now, and since we don't return much data we should always
      // stay under the 16 MB limit
      // TODO: maybe we should use a Bloom filter? https://redis.io/docs/data-types/probabilistic/bloom-filter/
      if (invocationCIDs.length > 100) {
        throw new Error('checking for more than 100 revocations in a single call is currently not supported')
      }
      const result = await dynamoDb.send(new BatchGetItemCommand({
        RequestItems: {
          [tableName]: {
            Keys: invocationCIDs.map(cid => marshall({ invocation: cid.toString() })),
            ProjectionExpression: 'invocation'
          }
        }
      }))

      // we need to check various possible error states here - if an error occured
      // should not return true or false, but rather return an error so it
      // can be propagated back to the user
      if (!result.Responses){
        throw new Error('Did not receive a response from DynamoDB')
      }
      if (result.UnprocessedKeys && (Object.keys(result.UnprocessedKeys).length > 0)) {
        throw new Error('Dynamo did not process all keys')
      }
      return result.Responses[tableName].length > 0
    }
  }
}
