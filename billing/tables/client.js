import { DynamoDBClient, GetItemCommand, PutItemCommand, QueryCommand } from '@aws-sdk/client-dynamodb'
import { marshall, unmarshall, convertToAttr } from '@aws-sdk/util-dynamodb'
import { RecordNotFound, StoreOperationFailure } from './lib.js'

/** @param {{ region: string } | DynamoDBClient} target */
export const connectTable = target =>
  target instanceof DynamoDBClient
    ? target
    : new DynamoDBClient(target)

/**
 * @template T
 * @param {{ region: string } | import('@aws-sdk/client-dynamodb').DynamoDBClient} conf
 * @param {object} context
 * @param {string} context.tableName
 * @param {import('../types').Validator<T>} context.validate
 * @param {import('../types').Encoder<T, import('../types').StoreRecord>} context.encode
 * @returns {import('../types').WritableStore<T>}
 */
export const createWritableStoreClient = (conf, context) => {
  const client = connectTable(conf)
  return {
    put: async (record) => {
      const validation = context.validate(record)
      if (validation.error) return validation

      const encoding = context.encode(record)
      if (encoding.error) return encoding

      const cmd = new PutItemCommand({
        TableName: context.tableName,
        Item: marshall(encoding.ok)
      })

      try {
        const res = await client.send(cmd)
        if (res.$metadata.httpStatusCode !== 200) {
          throw new Error(`unexpected status putting item to table: ${res.$metadata.httpStatusCode}`)
        }
        return { ok: {} }
      } catch (/** @type {any} */ error) {
        return {
          error: new StoreOperationFailure(error.message)
        }
      }
    }
  }
}

/**
 * @template {object} K
 * @template V
 * @param {{ region: string } | import('@aws-sdk/client-dynamodb').DynamoDBClient} conf
 * @param {object} context
 * @param {string} context.tableName
 * @param {import('../types').Encoder<K, import('../types').StoreRecord>} context.encodeKey
 * @param {import('../types').Decoder<import('../types').StoreRecord, V>} context.decode
 * @returns {import('../types').ReadableStore<K, V>}
 */
export const createReadableStoreClient = (conf, context) => {
  const client = connectTable(conf)
  return {
    get: async (key) => {
      const encoding = context.encodeKey(key)
      if (encoding.error) return encoding

      const cmd = new GetItemCommand({
        TableName: context.tableName,
        Key: marshall(encoding.ok)
      })

      let res
      try {
        res = await client.send(cmd)
        if (res.$metadata.httpStatusCode !== 200) {
          throw new Error(`unexpected status putting item to table: ${res.$metadata.httpStatusCode}`)
        }
      } catch (/** @type {any} */ error) {
        return {
          error: new StoreOperationFailure(error.message)
        }
      }

      if (!res.Item) {
        return { error: new RecordNotFound(key) }
      }

      return context.decode(unmarshall(res.Item))
    }
  }
}

/**
 * @template {object} K
 * @template V
 * @param {{ region: string } | import('@aws-sdk/client-dynamodb').DynamoDBClient} conf
 * @param {object} context
 * @param {string} context.tableName
 * @param {import('../types').Encoder<K, import('../types').StoreRecord>} context.encodeKey
 * @param {import('../types').Decoder<import('../types').StoreRecord, V>} context.decode
 * @returns {import('../types').PaginatedStore<K, V>}
 */
export const createPaginatedStoreClient = (conf, context) => {
  const client = connectTable(conf)
  return {
    list: async (key, options) => {
      const encoding = context.encodeKey(key)
      if (encoding.error) return encoding

      /** @type {Record<string, import('@aws-sdk/client-dynamodb').Condition>} */
      const conditions = {}
      for (const [k, v] of Object.entries(key)) {
        conditions[k] = {
          ComparisonOperator: 'EQ',
          AttributeValueList: [convertToAttr(v)]
        }
      }

      const cmd = new QueryCommand({
        TableName: context.tableName,
        Limit: options?.size ?? 100,
        KeyConditions: conditions,
        ExclusiveStartKey: options?.cursor
          ? marshall(JSON.parse(options.cursor))
          : undefined
      })
      const res = await client.send(cmd)
  
      const results = []
      for (const item of res.Items ?? []) {
        const decoding = context.decode(unmarshall(item))
        if (decoding.error) return decoding
        results.push(decoding.ok)
      }
      const lastKey = res.LastEvaluatedKey && unmarshall(res.LastEvaluatedKey)
      const cursor = lastKey && JSON.stringify(lastKey)
  
      return { ok: { cursor, results } }
    }
  }
}
