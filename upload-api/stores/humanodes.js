import { trace } from '@opentelemetry/api'
import {
  GetItemCommand,
  PutItemCommand,
} from '@aws-sdk/client-dynamodb'
import { marshall } from '@aws-sdk/util-dynamodb'
import { getDynamoClient } from '../../lib/aws/dynamo.js'
import { instrumentMethods } from '../lib/otel/instrument.js'

const tracer = trace.getTracer('upload-api')

/**
 * Abstraction layer to handle operations on humanodes table.
 *
 * @param {string} region
 * @param {string} tableName
 * @param {object} [options]
 * @param {string} [options.endpoint]
 */
export function createHumanodesTable(region, tableName, options = {}) {
  const dynamoDb = getDynamoClient({
    region,
    endpoint: options.endpoint,
  })

  return useHumanodesTable(dynamoDb, tableName)
}

/**
 * A table to track Humanode IDs.
 * 
 * Humanode has a facial hashing system that gives tells us whether we've
 * seen a particular face before. This table tracks whether we've seen
 * a specific face hash.
 * 
 * We use the name `sub` for the face hash because that is the name it
 * is given in the JWT we receive it in - it's short for `subject`.
 * 
 * @param {import('@aws-sdk/client-dynamodb').DynamoDBClient} dynamoDb
 * @param {string} tableName
 * @returns {import('../types.ts').HumanodeStore}
 */
export function useHumanodesTable(dynamoDb, tableName) {
  return instrumentMethods(tracer, 'HumanodesTable', {
    async add(sub, account) {
      try {
        await dynamoDb.send(new PutItemCommand({
          TableName: tableName,
          Item: marshall({
            sub,
            account
          }),
        }))
        return { ok: {} }
      } catch (/** @type {any} */err) {
        return {
          error: {
            name: 'UnexpectedError',
            message: err.message,
            cause: err
          }
        }
      }
    },

    async exists(sub) {
      try {
        const result = await dynamoDb.send(new GetItemCommand({
          TableName: tableName,
          Key: marshall({
            sub
          })
        }))
        return { ok: Boolean(result.Item) }
      } catch (/** @type {any} */err) {
        return {
          error: {
            name: 'UnexpectedError',
            message: err.message,
            cause: err
          }
        }
      }
    }
  })
}
