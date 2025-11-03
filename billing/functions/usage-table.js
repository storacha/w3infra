import * as Sentry from '@sentry/serverless'
import { Config } from 'sst/node/config'
import { unmarshall } from '@aws-sdk/util-dynamodb'
import Stripe from 'stripe'
import Big from 'big.js'
import * as Usage from '../data/usage.js'
import { expect } from './lib.js'
import { CID } from 'multiformats/cid'
import * as raw from 'multiformats/codecs/raw'
import { sha256 } from 'multiformats/hashes/sha2'

Sentry.AWSLambda.init({
  environment: process.env.SST_STAGE,
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 0
})

/**
 * @typedef {{ stripeSecretKey: string }} CustomHandlerContext
 */

export const handler = Sentry.AWSLambda.wrapHandler(
  /**
   * @param {import('aws-lambda').DynamoDBStreamEvent} event
   * @param {import('aws-lambda').Context} context
   */
  async (event, context) => {
    /** @type {CustomHandlerContext|undefined} */
    const customContext = context?.clientContext?.Custom
    const stripeSecretKey = customContext?.stripeSecretKey ?? Config.STRIPE_SECRET_KEY
    if (!stripeSecretKey) throw new Error('missing secret: STRIPE_SECRET_KEY')

    const records = parseUsageInsertEvent(event)
    if (!records.length) {
      throw new Error(`found no records in usage insert event: ${JSON.stringify(event)}`)
    }

    if (records.length > 1) {
      throw new Error(`invalid batch size, expected: 1, actual: ${records.length}`)
    }

    const ctx = {
      stripe: new Stripe(stripeSecretKey, { apiVersion: '2025-02-24.acacia' })
    }
    for (const usage of records) {
      expect(
        await reportUsage(usage, ctx),
        `sending usage to Stripe for: ${usage.space} customer: ${usage.customer} in period: ${usage.from} - ${usage.to}`
      )
    }
  }
)

/**
 * @param {import('aws-lambda').DynamoDBStreamEvent} event
 */
const parseUsageInsertEvent = event => {
  const records = []
  for (const r of event.Records) {
    console.log(`processing usage record: ${JSON.stringify(r)}`)
    if (r.eventName !== 'INSERT') continue
    if (!r.dynamodb) continue
    if (!r.dynamodb.NewImage) throw new Error('missing "NEW_IMAGE" in stream event')
    const usage = expect(
      // @ts-expect-error IDK why this is not Record<string, AttributeValue>
      Usage.decode(unmarshall(r.dynamodb.NewImage)),
      'decoding usage record'
    )
    records.push(usage)
  }
  return records
}

/**
 * @param {import('../lib/api.js').Usage} usage 
 */
async function createIdempotencyKey(usage){
  const digest = await sha256.digest(new TextEncoder().encode(`${usage.from.toISOString()}-${usage.to.toISOString()}/${usage.customer}/${usage.provider}/${usage.space}`))
  const cid = CID.create(1, raw.code, digest)
  return cid.toString()
}

/**
 * Reports usage to Stripe. Note we use an `idempotencyKey` but this is only
 * retained by Stripe for 24 hours. Thus, retries should not be attempted for
 * the same usage record after 24 hours. The default DynamoDB stream retention
 * is 24 hours so this should be fine for intermittent failures.
 *
 * @param {import('../lib/api.js').Usage} usage 
 * @param {{ stripe: Stripe }} ctx
 * @returns {Promise<import('@ucanto/interface').Result<import('@ucanto/interface').Unit>>}
 */
const reportUsage = async (usage, ctx) => {
  console.log(`Processing usage for: ${usage.space}`)
  console.log(`Provider: ${usage.provider}`)
  console.log(`Customer: ${usage.customer}`)
  console.log(`Account: ${usage.account}`)
  console.log(`Period: ${usage.from.toISOString()} - ${usage.to.toISOString()}`)

  if (usage.space === 'did:key:z6Mkj8ynPJNkKc1e6S9VXpVDfQd8M1bPxZTgDg2Uhhjt9LoV') {
    console.log('not reporting usage for space: did:key:z6Mkj8ynPJNkKc1e6S9VXpVDfQd8M1bPxZTgDg2Uhhjt9LoV')
    return { ok: {} }
  }

  if (!usage.account.startsWith('stripe:')) {
    return { error: new Error('unknown payment system') }
  }

  const customer = usage.account.replace('stripe:', '')

  const { data: subs } = await ctx.stripe.subscriptions.list({
    customer,
    status: 'all',
    limit: 1
  })

  const sub = subs.find(s => s.status === 'active') ?? subs[0]
  if (!sub) {
    return { error: new Error(`no subscriptions: ${usage.account}`) }
  }
  console.log(`Found Stripe subscription: ${sub.id}`)

  const subItem = sub.items.data[0]
  if (!subItem) {
    return { error: new Error(`no subscription items: ${sub.id}`) }
  }
  console.log(`Found Stripe subscription item: ${subItem.id}`)

  const duration = usage.to.getTime() - usage.from.getTime()
  const quantity = Math.floor(new Big(usage.usage.toString()).div(duration).div(1024 * 1024 * 1024).toNumber())

  console.log(`Reporting usage of ${usage.usage} byte-ms for ${usage.space} as quantity: ${quantity} bytes/month`)

  const idempotencyKey = await createIdempotencyKey(usage)
  const usageRecord = await ctx.stripe.subscriptionItems.createUsageRecord(
    subItem.id,
    { quantity, action: 'increment' },
    { idempotencyKey }
  )

  console.log(`Created Stripe usage record with ID: ${usageRecord.id}`)

  const byteQuantity = Math.floor(new Big(usage.usage.toString()).div(duration).toNumber())

  /*
   * Billing migration: dual reporting (usage records + billing meters)
   *
   * We are migrating from Stripe Subscription Usage Records to Stripe Billing Meters.
   * During the migration window we intentionally report usage via BOTH mechanisms:
   *
   * - Current (charging) path: create a Usage Record on the subscription item.
   *   This is how customers are billed today and MUST remain until we fully cut over.
   *
   * - Migration (shadow) path: emit a Billing Meter event (event_name: 'usage-billing-meter').
   *   This lets us observe and compare meter-based totals against our existing
   *   usage-record-based totals without impacting invoices.
   *
   * Important:
   * - If the customer does NOT have the new meter-based price configured in Stripe,
   *   Stripe will NOT charge based on the meter events. That’s expected and desired
   *   during the shadow phase so we can safely compare numbers from both methods.
   * - We timestamp the meter event at the end of the previous month (UTC 23:59:59),
   *   aligning the event with the finalized period we just reported via usage record.
   *
   * Once parity is confirmed, we can stop sending usage records and rely solely on
   * Billing Meters for storage billing.
   */

  // Calculate the timestamp for the last day of the previous month at 23:59:59 UTC
  const now = new Date()
  const referenceDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0, 23, 59, 59))

  const meterEvent = await ctx.stripe.billing.meterEvents.create({
    event_name: 'usage-billing-meter',
    timestamp: Math.floor(referenceDate.getTime() / 1000),
    identifier: idempotencyKey,
    payload: {
      stripe_customer_id: customer,
      value: byteQuantity.toString(),
    },
  })

  console.log(`Created Stripe billing meter event. `, meterEvent)

  return { ok: usageRecord }
}
