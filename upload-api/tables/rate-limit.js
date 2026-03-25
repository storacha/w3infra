import { trace } from '@opentelemetry/api'
import {
  DeleteItemCommand,
  PutItemCommand,
  QueryCommand,
} from '@aws-sdk/client-dynamodb'
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb'
import { nanoid } from 'nanoid'
import { fromEmail } from '@storacha/did-mailto'
import { getDynamoClient } from '../../lib/aws/dynamo.js'
import { instrumentMethods } from '../lib/otel/instrument.js'

/**
 * @import { RateLimit } from '@storacha/upload-api'
 * @import { StoreGetter, CustomerKey, Customer } from '../../billing/lib/api.js'
 */

const tracer = trace.getTracer('upload-api')

/**
 * Abstraction layer to handle operations on Rate Limit Table.
 *
 * @param {string} region
 * @param {string} tableName
 * @param {object} [options]
 * @param {string} [options.endpoint]
 * @param {number} [options.unknownCustomerRate] The rate limit for unknown
 * customers. If set then options.customerStore must be provided.
 * @param {StoreGetter<CustomerKey, Customer>} [options.customerStore] The
 * customer store to use for determining if a customer is known or not.
 */
export function createRateLimitTable (region, tableName, options = {}) {
  const dynamoDb = getDynamoClient({
    region,
    endpoint: options.endpoint,
  })

  return useRateLimitTable(dynamoDb, tableName, options)
}

/**
 * @param {import('@aws-sdk/client-dynamodb').DynamoDBClient} dynamoDb
 * @param {string} tableName
 * @returns {import('@storacha/upload-api').RateLimitsStorage}
 * @param {object} [options]
 * @param {number} [options.unknownCustomerRate] The rate limit for unknown
 * customers. If set then options.customerStore must be provided.
 * @param {StoreGetter<CustomerKey, Customer>} [options.customerStore] The
 * customer store to use for determining if a customer is known or not.
 */
export function useRateLimitTable (dynamoDb, tableName, options = {}) {
  const { unknownCustomerRate, customerStore } = options
  return instrumentMethods(tracer, 'RateLimitTable', {
    add: async (subject, rate) => {
      const insertedAt = new Date().toISOString()
      const id = nanoid()
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
      /** @type {RateLimit[]} */
      const limits = []
      if (customerStore && typeof unknownCustomerRate === 'number') {
        let customer
        try {
          // @ts-expect-error subject might be an email address, domain or DID.
          // If an email address then we can convert into a customer DID to
          // determine if it's a known customer or not and apply the rate limit. 
          customer = fromEmail(subject)
        } catch {
          // if not an email then continue as usual
        }
        if (customer) {
          const cusRes = await customerStore.get({ customer })
          if (cusRes.error) {
            if (cusRes.error.name !== 'RecordNotFound') {
              return cusRes
            }
            limits.push({ id: `unknown/${customer}`, rate: unknownCustomerRate })
          }
        }
      }
      const response = await dynamoDb.send(new QueryCommand({
        TableName: tableName,
        IndexName: 'subject',
        KeyConditionExpression: "subject = :subject",
        ExpressionAttributeValues: {
          ':subject': { S: subject }
        },
      }))
      for (const item of response.Items ?? []) {
        const unmarshaled = unmarshall(item)
        limits.push({ id: unmarshaled.id, rate: unmarshaled.rate })
      }
      return { ok: limits }
    }
  })
}
