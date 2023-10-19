import { DynamoDBClient, QueryCommand } from '@aws-sdk/client-dynamodb'
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb'
import * as Link from 'multiformats/link'

/**
 * @param {string} region 
 * @param {string} table
 * @param {object} [options]
 * @param {URL} [options.endpoint]
 */
export const createCustomerStore = (region, table, options) => {
  const dynamo = new DynamoDBClient({ region, endpoint: options?.endpoint?.toString() })
  return useCustomerStore(dynamo, table)
}

/**
 * @param {DynamoDBClient} dynamo 
 * @param {string} table
 * @returns {import('../types').CustomerStore}
 */
export const useCustomerStore = (dynamo, table) => ({
  async list (options) {
    const cmd = new QueryCommand({
      TableName: table,
      Limit: options?.size ?? 100,
      ExclusiveStartKey: options?.cursor
        ? marshall(options.cursor)
        : undefined
    })
    const res = await dynamo.send(cmd)

    const results = (res.Items ?? []).map(item => {
      const raw = unmarshall(item)
      return /** @type {import('../types').CustomerRecord} */ ({
        cause: Link.parse(raw.cause),
        customer: raw.customer,
        account: raw.account,
        product: raw.product,
        insertedAt: new Date(raw.insertedAt),
        updatedAt: new Date(raw.updatedAt)
      })
    })
    const lastKey = res.LastEvaluatedKey && unmarshall(res.LastEvaluatedKey)
    const cursor = lastKey && lastKey.customer

    return { ok: { cursor, results } }
  }
})
