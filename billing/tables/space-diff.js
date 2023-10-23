import { QueryCommand } from '@aws-sdk/client-dynamodb'
import { marshall, unmarshall, convertToAttr } from '@aws-sdk/util-dynamodb'
import { connectTable, createStorePutterClient } from './client.js'
import { validate, encode, encodeKey, decode } from '../data/space-diff.js'

/**
 * Stores changes to total space size.
 *
 * @type {import('@serverless-stack/resources').TableProps}
 */
export const spaceDiffTableProps = {
  fields: {
    /** Customer DID (did:mailto:...). */
    customer: 'string',
    /** Space DID (did:key:...). */
    space: 'string',
    /** Storage provider for the space. */
    provider: 'string',
    /** Subscription in use when the size changed. */
    subscription: 'string',
    /** Invocation CID that changed the space size (bafy...). */
    cause: 'string',
    /** Number of bytes added to or removed from the space. */
    change: 'number',
    /** ISO timestamp the receipt was issued. */
    receiptAt: 'string',
    /** ISO timestamp we recorded the change. */
    insertedAt: 'string'
  },
  primaryIndex: { partitionKey: 'customer', sortKey: 'receiptAt' }
}

/**
 * @param {string} region 
 * @param {string} tableName
 * @param {object} [options]
 * @param {URL} [options.endpoint]
 * @returns {import('../lib/api').SpaceDiffStore}
 */
export const createSpaceDiffStore = (region, tableName, options) => {
  const client = connectTable({ region })
  return {
    ...createStorePutterClient({ region }, { tableName, validate, encode }),
    async listBetween (key, from, to, options) {
      const encoding = encodeKey(key)
      if (encoding.error) return encoding

      const cmd = new QueryCommand({
        TableName: tableName,
        Limit: options?.size ?? 100,
        KeyConditions: {
          customer: {
            ComparisonOperator: 'EQ',
            AttributeValueList: [convertToAttr(key.customer)]
          },
          receiptAt: {
            ComparisonOperator: 'BETWEEN',
            AttributeValueList: [convertToAttr(from.toISOString()), convertToAttr(to.toISOString())]
          }
        },
        ExclusiveStartKey: options?.cursor
          ? marshall(JSON.parse(options.cursor))
          : undefined
      })
      const res = await client.send(cmd)
  
      const results = []
      for (const item of res.Items ?? []) {
        const decoding = decode(unmarshall(item))
        if (decoding.error) return decoding
        results.push(decoding.ok)
      }
      const lastKey = res.LastEvaluatedKey && unmarshall(res.LastEvaluatedKey)
      const cursor = lastKey && JSON.stringify(lastKey)
  
      return { ok: { cursor, results } }
    }
  }
}
