import { DynamoDBClient, GetItemCommand, PutItemCommand, QueryCommand, ScanCommand } from '@aws-sdk/client-dynamodb'
import { marshall, unmarshall, convertToAttr } from '@aws-sdk/util-dynamodb'
import retry from 'p-retry'
import { RecordNotFound, StoreOperationFailure, getDynamoClient } from './lib.js'

/** @param {{ region: string } | DynamoDBClient} target */
export const connectTable = target =>
  target instanceof DynamoDBClient
    ? target
    : getDynamoClient(target.region)

/**
 * @template T
 * @param {{ region: string } | import('@aws-sdk/client-dynamodb').DynamoDBClient} conf
 * @param {object} context
 * @param {string} context.tableName
 * @param {import('../lib/api').Validator<T>} context.validate
 * @param {import('../lib/api').Encoder<T, import('../types').StoreRecord>} context.encode
 * @returns {import('../lib/api').StorePutter<T>}
 */
export const createStorePutterClient = (conf, context) => {
  const client = connectTable(conf)
  return {
    put: async (record) => {
      const validation = context.validate(record)
      if (validation.error) return validation

      const encoding = context.encode(validation.ok)
      if (encoding.error) return encoding

      const cmd = new PutItemCommand({
        TableName: context.tableName,
        Item: marshall(encoding.ok, { removeUndefinedValues: true })
      })

      try {
        await retry(async () => {
          const res = await client.send(cmd)
          if (res.$metadata.httpStatusCode !== 200) {
            throw new Error(`unexpected status putting item to table: ${res.$metadata.httpStatusCode}`)
          }
        }, {
          retries: 3,
          minTimeout: 100,
          onFailedAttempt: console.warn
        })
        return { ok: {} }
      } catch (/** @type {any} */ err) {
        console.error(err)
        return { error: new StoreOperationFailure(err.message, { cause: err }) }
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
 * @param {import('../lib/api').Encoder<K, import('../types').StoreRecord>} context.encodeKey
 * @param {import('../lib/api').Decoder<import('../types').StoreRecord, V>} context.decode
 * @returns {import('../lib/api').StoreGetter<K, V>}
 */
export const createStoreGetterClient = (conf, context) => {
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
        res = await retry(async () => {
          const res = await client.send(cmd)
          if (res.$metadata.httpStatusCode !== 200) {
            throw new Error(`unexpected status getting item from table: ${res.$metadata.httpStatusCode}`)
          }
          return res
        }, {
          retries: 3,
          minTimeout: 100,
          onFailedAttempt: console.warn
        })
      } catch (/** @type {any} */ err) {
        console.error(err)
        return { error: new StoreOperationFailure(err.message, { cause: err }) }
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
 * @param {import('../lib/api').Encoder<K, import('../types').StoreRecord>} context.encodeKey
 * @param {import('../lib/api').Decoder<import('../types').StoreRecord, V>} context.decode
 * @param {string} [context.indexName]
 * @returns {import('../lib/api').StoreLister<K, V>}
 */
export const createStoreListerClient = (conf, context) => {
  const client = connectTable(conf)
  return {
    list: async (key, options) => {
      const encoding = context.encodeKey(key)
      if (encoding.error) return encoding

      /** @type {Record<string, import('@aws-sdk/client-dynamodb').Condition>|undefined} */
      let conditions
      for (const [k, v] of Object.entries(encoding.ok)) {
        conditions = conditions ?? {}
        conditions[k] = {
          // Multiple conditions imply a sort key so must be GE in order to
          // list more than one item. Otherwise this would be a StoreGetter.
          ComparisonOperator: Object.keys(conditions).length ? 'GE' : 'EQ',
          AttributeValueList: [convertToAttr(v)]
        }
      }

      const cmd = conditions
        ? new QueryCommand({
          TableName: context.tableName,
          IndexName: context.indexName,
          Limit: options?.size ?? 100,
          KeyConditions: conditions,
          ExclusiveStartKey: options?.cursor
            ? marshall(JSON.parse(options.cursor))
            : undefined
        })
        : new ScanCommand({
          TableName: context.tableName,
          Limit: options?.size ?? 100,
          ExclusiveStartKey: options?.cursor
            ? marshall(JSON.parse(options.cursor))
            : undefined
        })

      let res
      try {
        res = await retry(async () => {
          const res = await client.send(cmd)
          if (res.$metadata.httpStatusCode !== 200) {
            throw new Error(`unexpected status listing table content: ${res.$metadata.httpStatusCode}`)
          }
          return res
        }, {
          retries: 3,
          minTimeout: 100,
          onFailedAttempt: console.warn
        })
      } catch (/** @type {any} */ err) {
        console.error(err)
        return { error: new StoreOperationFailure(err.message, { cause: err }) }
      }
  
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
