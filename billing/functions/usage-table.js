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
import { createUsageStore } from '../tables/usage.js'
import { mustGetEnv } from '../../lib/env.js'
import { startOfMonth } from '../lib/util.js'

Sentry.AWSLambda.init({
  environment: process.env.SST_STAGE,
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 0
})

/**
 * @typedef {{
 *   stripeSecretKey: string
 *   region?: string
 *   usageTableName?: string
 * }} CustomHandlerContext
 */

const STRIPE_BILLING_EVENT = {
  name: 'storage_in_bytes_per_month',
  id: 'mtr_61TeHsOrkWSkk6oRB41F6A5ufQX5vO7c'
}

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

    const region = customContext?.region ?? mustGetEnv('AWS_REGION')
    const usageTableName = customContext?.usageTableName ?? mustGetEnv('USAGE_TABLE_NAME')
 
    const ctx = {
      stripe: new Stripe(stripeSecretKey, { apiVersion: '2025-02-24.acacia' }),
      usageStore: createUsageStore({ region }, { tableName: usageTableName })
    }
    for (const usage of records) {
      expect(
        await reportUsage(usage, ctx),
        `==> ($) Sent usage to Stripe for: ${usage.space} customer: ${usage.customer} in period: ${usage.from} - ${usage.to}`
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
 * Queries the usage table for the previous day's usage record.
 *
 * @param {import('../lib/api.js').Usage} currentUsage
 * @param {{ stripe: Stripe, usageStore: import('../lib/api.js').UsageStore }} ctx
 * @returns {Promise<bigint>} Previous cumulative usage (0n if not found)
 */
async function getPreviousUsage(currentUsage, ctx) {
  // Calculate previous day's date (from - 24 hours)
  const previousFrom = new Date(currentUsage.from.getTime() - 24 * 60 * 60 * 1000)

  // Query usage table with: customer PK, sk = previousFrom#provider#space
  const result = await ctx.usageStore.get({
    customer: currentUsage.customer,
    from: previousFrom,
    provider: currentUsage.provider,
    space: currentUsage.space
  })

  if (result.ok) {
    return result.ok.usage
  }

  if (result.error && result.error.name !== 'RecordNotFound') {
    throw result.error
  }

  console.log(`⚠️ No previous usage found for ${currentUsage.space} on ${previousFrom.toISOString()}.\n Attempting to recover using Stripe meter event summaries...`)

  // Query Stripe for summaries (returns in reverse chronological order - newest first)
  const summaries = await ctx.stripe.billing.meters.listEventSummaries(STRIPE_BILLING_EVENT.id, {
    customer: currentUsage.account.replace('stripe:', ''),
    start_time: startOfMonth(currentUsage.from).getTime() / 1000,
    end_time: currentUsage.to.getTime() / 1000,
    value_grouping_window: 'day',
    limit: 1
  });

  if (!summaries.data || summaries.data.length === 0) {
    console.log(`No Stripe summaries found - treating as first-time customer`)
    return 0n
  }

  const latestSummary = summaries.data[0]
  const latestSummaryDate = new Date(latestSummary.end_time * 1000);

  console.log(`Found latest Stripe summary: ${latestSummaryDate.toISOString()}`)
  
  // Query DynamoDB for usage at Stripe's latest date
  const recoveryResult = await ctx.usageStore.get({
    customer: currentUsage.customer,
    from: latestSummaryDate,
    provider: currentUsage.provider,
    space: currentUsage.space
  })

  if (recoveryResult.ok) {
    console.log(`⚠️ WARNING: Space ${currentUsage.space} usage between ${latestSummaryDate.toISOString()} and ${previousFrom.toISOString()} is lost using Stripe summaries for recovery.`)
    return recoveryResult.ok.usage
  }

  if (recoveryResult.error?.name === 'RecordNotFound') {
    console.error(`CRITICAL DATA LOSS: Cannot calculate usage delta. Manual investigation and correction required. \n ${JSON.stringify({
      previousDay: previousFrom.toISOString(),
      latestSummaryDate: latestSummaryDate.toISOString(),
      space: currentUsage.space,
      customer: currentUsage.customer,
      stripeAggregatedValue: latestSummary.aggregated_value,
    })}`)

    throw new Error(
      `Critical: Cannot calculate usage delta for space ${currentUsage.space}. ` +
      `Both DynamoDB records missing (${previousFrom.toISOString()} and ${latestSummaryDate.toISOString()}). ` +
      `This indicates data loss. Manual investigation required.`
    )
  }
  
   throw recoveryResult.error ?? new Error('Unknown error querying usage store during recovery')   
}

/**
 * Reports usage to Stripe. Note we use an `idempotencyKey` but this is only
 * retained by Stripe for 24 hours. Thus, retries should not be attempted for
 * the same usage record after 24 hours. The default DynamoDB stream retention
 * is 24 hours so this should be fine for intermittent failures.
 *
 * @param {import('../lib/api.js').Usage} usage
 * @param {{ stripe: Stripe, usageStore: import('../lib/api.js').UsageStore }} ctx
 * @returns {Promise<import('@ucanto/interface').Result<import('@ucanto/interface').Unit>>}
 */
export const reportUsage = async (usage, ctx) => {
  const usageContext = {
    space: usage.space,
    provider: usage.provider,
    customer: usage.customer,
    account: usage.account,
    product: usage.product,
    usage: usage.usage,
    period: {
      from: usage.from.toISOString(),
      to: usage.to.toISOString()
    }
  }

  console.log(`Processing usage...\n${JSON.stringify(usageContext)}`)

  if (usage.space === 'did:key:z6Mkj8ynPJNkKc1e6S9VXpVDfQd8M1bPxZTgDg2Uhhjt9LoV') {
    console.log('not reporting usage for space: did:key:z6Mkj8ynPJNkKc1e6S9VXpVDfQd8M1bPxZTgDg2Uhhjt9LoV')
    return { ok: {} }
  }

  if (!usage.account.startsWith('stripe:')) {
    return { error: new Error('unknown payment system') }
  }

  const customer = usage.account.replace('stripe:', '')

  // Validate the Stripe customer before sending usage. 
  const stripeCustomer = await ctx.stripe.customers.retrieve(customer, {
    expand: ['subscriptions'],
  })

  // return ok so the Lambda exits cleanly, since retrying will never succeed.
  // The customer used the service and is not being billed; manual follow-up required.
  if (stripeCustomer.deleted) {
    console.error(
      `Stripe customer ${customer} has been deleted. ` +
      `Skipping usage report for customer DID: ${usage.customer}, ` +
      `space: ${usage.space}, provider: ${usage.provider}, ` +
      `period: ${usage.from.toISOString()} - ${usage.to.toISOString()}. ` +
      `Manual review required.`
    )
    return { ok: {} }
  }

  const pastDueSubs = (stripeCustomer.subscriptions?.data ?? []).filter(
    (s) => s.status === 'past_due'
  )
  if (pastDueSubs.length > 0) {
    console.warn(
      `Stripe customer ${customer} (customer DID: ${usage.customer}) has ` +
      `${pastDueSubs.length} past-due subscription(s). ` +
      `Usage will still be reported but overages may not be collected.`
    )
  }

  const duration = usage.to.getTime() - usage.from.getTime()

  // Validate billing period duration
  if (duration <= 0) {
    return {
      error: new Error(
        `Invalid billing period: duration=${duration}ms, from=${usage.from.toISOString()}, to=${usage.to.toISOString()}`
      )
    }
  }

  const isFirstOfMonth = usage.from.getUTCDate() === 1
  // NOTE: Since Stripe aggregates per billing period (monthly), each month starts fresh so no need to get previous usage and calculate delta.
  let previousCumulativeUsage                                                                                                
  try {                                                                                                                      
    previousCumulativeUsage = isFirstOfMonth ? 0n : await getPreviousUsage(usage, ctx)                                       
  } catch (/** @type {any} */ err) {                                                                                         
    return { error: err }                                                                                                    
  } 

  // Calculate delta: current cumulative - previous cumulative (or 0 if no previous)
  // Note: Delta can be negative if users deleted data
  const deltaUsage = usage.usage - previousCumulativeUsage

  if (isFirstOfMonth) {                                                                                                      
    console.log(`First of month reset - reporting full usage as delta (no previous lookup)`, JSON.stringify({customer: usageContext.customer, space: usageContext.space}))                            
  } else if (previousCumulativeUsage === 0n) {
    console.log(`No previous usage found - reporting full current usage as delta`, JSON.stringify({customer: usageContext.customer, space: usageContext.space}))
  } else {
    console.log('Delta calculation:', JSON.stringify({
      space: usageContext.space,
      previousCumulativeUsage: previousCumulativeUsage.toString(),
      currentUsage: usage.usage.toString(),
      deltaUsage: deltaUsage.toString()
    }))
  }

  // Calculate cumulative byte quantity (for logging) - average over the entire month-to-date
  const monthStart = startOfMonth(usage.to)
  const cumulativeDuration = usage.to.getTime() - monthStart.getTime()
  const cumulativeByteQuantity = Math.floor(new Big(usage.usage.toString()).div(cumulativeDuration).toNumber())

  // Convert delta to byte quantity for Stripe
  const deltaByteQuantity = Math.floor(new Big(deltaUsage.toString()).div(duration).toNumber())
  const deltaGibQuantity = deltaByteQuantity / (1024 * 1024 * 1024)

  const usageSummary = {
    space: usage.space,
    customer: usage.customer,
    cumulative: {
      bytesAverage: cumulativeByteQuantity,  // Average bytes from month start to now
      byteMs: usage.usage.toString()
    },
    delta: {
      bytes: deltaByteQuantity,
      gib: deltaGibQuantity,
      byteMs: deltaUsage.toString()
    }
  }
  console.log(`Usage summary:\n ${JSON.stringify(usageSummary)}`)

  const idempotencyKey = await createIdempotencyKey(usage)
  const referenceDate = new Date(usage.to.getTime())

  const stripeRequest = {
    message: 'Sending usage to Stripe',
    space: usage.space,
    customer: usage.customer,
    deltaBytes: deltaByteQuantity,
    timestamp: referenceDate.toISOString(),
    idempotencyKey
  }

  if (deltaByteQuantity == 0 ) {
    console.log(`No usage delta to report to Stripe. Skipping.\n${JSON.stringify(stripeRequest)}`)
    return { ok: {} }
  }

  console.log(`sending Stripe request:\n${JSON.stringify(stripeRequest)}`)

  const meterEvent = await ctx.stripe.billing.meterEvents.create({
    event_name: STRIPE_BILLING_EVENT.name,
    timestamp: Math.floor(referenceDate.getTime() / 1000),
    identifier: idempotencyKey,
    payload: {
      stripe_customer_id: customer,
      bytes: deltaByteQuantity.toString(),
    },
  })

  console.log(`Created Stripe billing meter event:\n${JSON.stringify(meterEvent)}`)
  return { ok: meterEvent }
}
