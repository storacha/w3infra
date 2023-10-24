import * as Sentry from '@sentry/serverless'
import { toString, fromString } from 'uint8arrays'
import * as Link from 'multiformats/link'
import { createSpaceDiffStore } from '../tables/space-diff.js'
import { createSubscriptionStore } from '../tables/subscription.js'
import { createConsumerStore } from '../tables/consumer.js'
import { notNully } from './lib.js'
import { handleUsageInsert } from '../lib/usage-table.js'

Sentry.AWSLambda.init({
  environment: process.env.SST_STAGE,
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 1.0
})

/**
 * @typedef {{
 *   spaceDiffTable?: string
 *   subscriptionTable?: string
 *   consumerTable?: string
 *   dbEndpoint?: URL
 *   region?: 'us-west-2'|'us-east-2'
 * }} CustomHandlerContext
 */

export const handler = Sentry.AWSLambda.wrapHandler(
  /**
   * @param {import('aws-lambda').DynamoDBStreamEvent} event
   * @param {import('aws-lambda').Context} context
   */
  async (event, context) => {
    /** @type {CustomHandlerContext|undefined} */
    const customContext = context?.clientContext?.Custom
    const spaceDiffTable = customContext?.spaceDiffTable ?? notNully(process.env, 'SPACE_DIFF_TABLE_NAME')
    const subscriptionTable = customContext?.subscriptionTable ?? notNully(process.env, 'SUBSCRIPTION_TABLE_NAME')
    const consumerTable = customContext?.consumerTable ?? notNully(process.env, 'CONSUMER_TABLE_NAME')
    const dbEndpoint = new URL(customContext?.dbEndpoint ?? notNully(process.env, 'DB_ENDPOINT'))
    const region = customContext?.region ?? notNully(process.env, 'AWS_REGION')
  
    const records = parseUsageInsertEvent(event)
    if (!records.length) return

    const storeOptions = { endpoint: dbEndpoint }
    const ctx = {
      spaceDiffStore: createSpaceDiffStore(region, spaceDiffTable, storeOptions),
      subscriptionStore: createSubscriptionStore(region, subscriptionTable, storeOptions),
      consumerStore: createConsumerStore(region, consumerTable, storeOptions)
    }
    const results = await Promise.all(records.map(m => handleUsageInsert(m, ctx)))
    for (const r of results) if (r.error) throw r.error
  }
)

/**
 * @param {import('aws-lambda').DynamoDBStreamEvent} event
 * @returns {import('../lib/api').Usage[]}
 */
const parseUsageInsertEvent = event => {
  const usages = []
  for (const r of event.Records) {
    if (r.eventName !== 'INSERT') continue
    usages.push(r.dynamodb)
  }

  const batch = event.Records.map(r => fromString(r.kinesis.data, 'base64'))
  return batch.map(b => {
    const json = JSON.parse(toString(b, 'utf8'))
    return {
      ...json,
      carCid: Link.parse(json.carCid),
      invocationCid: Link.parse(json.invocationCid),
      ts: new Date(json.ts)
    }
  })
}
