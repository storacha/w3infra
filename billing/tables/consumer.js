import { DynamoDBClient, QueryCommand } from '@aws-sdk/client-dynamodb'
import { unmarshall } from '@aws-sdk/util-dynamodb'
import * as Link from 'multiformats/link'

/**
 * @param {string} region 
 * @param {string} table
 * @param {object} [options]
 * @param {URL} [options.endpoint]
 */
export const createConsumerStore = (region, table, options) => {
  const dynamo = new DynamoDBClient({ region, endpoint: options?.endpoint?.toString() })
  return useConsumerStore(dynamo, table)
}

/**
 * @param {DynamoDBClient} dynamo 
 * @param {string} table
 * @returns {import('../types').ConsumerStore}
 */
export const useConsumerStore = (dynamo, table) => ({
  async getBatch (consumer) {
    const cmd = new QueryCommand({
      TableName: table,
      KeyConditions: {
        consumer: {
          ComparisonOperator: 'EQ',
          AttributeValueList: [{ S: consumer }]
        }
      }
    })
    const res = await dynamo.send(cmd)
    if (!res.Items) {
      return { error: new Error('missing items in response') }
    }

    /** @type {import('../types').ConsumerRecord[]} */
    const items = res.Items.map(item => {
      const raw = unmarshall(item)
      return {
        consumer: raw.consumer,
        provider: raw.provider,
        subscription: raw.subscription,
        cause: Link.parse(raw.cause),
        insertedAt: new Date(raw.insertedAt),
        updatedAt: new Date(raw.updatedAt)
      }
    })

    return { ok: items }
  }
})
