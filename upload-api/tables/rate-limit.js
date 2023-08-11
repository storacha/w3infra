import {
  DeleteItemCommand,
  DynamoDBClient, PutItemCommand, QueryCommand,
} from '@aws-sdk/client-dynamodb'
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb'
import { nanoid } from 'nanoid/async'

/**
 * Abstraction layer to handle operations on Store Table.
 *
 * @param {string} region
 * @param {string} tableName
 * @param {object} [options]
 * @param {string} [options.endpoint]
 */
export function createRateLimitTable (region, tableName, options = {}) {
  const dynamoDb = new DynamoDBClient({
    region,
    endpoint: options.endpoint,
  })

  return useRateLimitTable(dynamoDb, tableName)
}

/**
 * @param {DynamoDBClient} dynamoDb
 * @param {string} tableName
 * @returns {import('@web3-storage/upload-api').RateLimitsStorage}
 */
export function useRateLimitTable (dynamoDb, tableName) {
  return {
    add: async (subject, rate) => {
      const insertedAt = new Date().toISOString()
      const id = await nanoid()
      const row = {
        id,
        subject,
        rate,
        insertedAt,
        updatedAt: insertedAt
      }

      await dynamoDb.send(new PutItemCommand({
        TableName: tableName,
        Item: marshall(row),
      }))
      return { ok: { id } }
    },

    remove: async (id) => {
      await dynamoDb.send(new DeleteItemCommand({
        TableName: tableName,
        Key: marshall({ id })
      }))
      return { ok: {} }
    },

    list: async (subject) => {
      const response = await dynamoDb.send(new QueryCommand({
        TableName: tableName,
        IndexName: 'subject',
        KeyConditionExpression: "subject = :subject",
        ExpressionAttributeValues: {
          ':subject': { S: subject }
        },
      }))
      return {
        ok: response.Items ? response.Items.map(i => {
          const item = unmarshall(i)
          return { id: item.id, rate: item.rate }
        }) : []
      }
    }
  }
}
