import { DynamoDBClient, GetItemCommand } from '@aws-sdk/client-dynamodb'
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb'
import * as Link from 'multiformats/link'
import { Failure } from '@ucanto/server'

/**
 * @param {string} region 
 * @param {string} table
 * @param {object} [options]
 * @param {URL} [options.endpoint]
 */
export const createSubscriptionStore = (region, table, options) => {
  const dynamo = new DynamoDBClient({ region, endpoint: options?.endpoint?.toString() })
  return useSubscriptionStore(dynamo, table)
}

/**
 * @param {DynamoDBClient} dynamo 
 * @param {string} table
 * @returns {import('../types').SubscriptionStore}
 */
export const useSubscriptionStore = (dynamo, table) => ({
  async get (provider, subscription) {
    const cmd = new GetItemCommand({
      TableName: table,
      Key: marshall({ provider, subscription })
    })
    const res = await dynamo.send(cmd)
    if (!res.Item) {
      return { error: new SubscriptionNotFound(provider, subscription) }
    }

    const raw = unmarshall(res.Item)

    /** @type {import('../types').SubscriptionRecord} */
    const record = {
      customer: raw.consumer,
      provider: raw.provider,
      subscription: raw.subscription,
      cause: Link.parse(raw.cause),
      insertedAt: new Date(raw.insertedAt),
      updatedAt: new Date(raw.updatedAt)
    }

    return { ok: record }
  }
})

export class SubscriptionNotFound extends Failure {
  /**
   * @param {import('@ucanto/interface').DID} provider
   * @param {string} subscription
   */
  constructor (provider, subscription) {
    super()
    this.provider = provider
    this.subscription = subscription
    this.name = /** @type {const} */ ('SubscriptionNotFound')
  }

  describe () {
    return `subscription not found: ${this.subscription} for provider: ${this.provider}`
  }
}
