import * as Sentry from '@sentry/serverless'
import { Config } from 'sst/node/config'
import { unmarshall } from '@aws-sdk/util-dynamodb'
import Stripe from 'stripe'
import * as Usage from '../data/usage.js'
import { expect } from './lib.js'
import { CID } from 'multiformats/cid'
import * as raw from 'multiformats/codecs/raw'
import { sha256 } from 'multiformats/hashes/sha2'
import { createUsageStore } from '../tables/usage.js'
import { createSpaceSnapshotStore } from '../tables/space-snapshot.js'
import { mustGetEnv } from '../../lib/env.js'
import { findPreviousUsageBySnapshotDate, calculateDeltaMetrics } from '../lib/usage-calculations.js'

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
 *   snapshotTableName?: string
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
    const snapshotTableName = customContext?.snapshotTableName ?? mustGetEnv('SPACE_SNAPSHOT_TABLE_NAME')

    const ctx = {
      stripe: new Stripe(stripeSecretKey, { apiVersion: '2025-02-24.acacia' }),
      usageStore: createUsageStore({ region }, { tableName: usageTableName }),
      spaceSnapshotStore: createSpaceSnapshotStore({ region }, { tableName: snapshotTableName })
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
 * Validates whether a Stripe customer should be billed.
 * Checks payment system, customer status, and subscription states.
 *
 * @param {import('../lib/api.js').Usage} usage
 * @param {{ stripe: Stripe }} ctx
 * @returns {Promise<import('@ucanto/interface').Result<{ shouldBill: boolean, stripeId: string }>>} Returns true if should bill, false if should skip
 */
async function validateStripeCustomerForBilling(usage, ctx) {
  if (!usage.account.startsWith('stripe:')) {
    return { error: new Error('unknown payment system') }
  }

  const customer = usage.account.replace('stripe:', '')

  // Validate the Stripe customer before sending usage.
  const stripeCustomer = await ctx.stripe.customers.retrieve(customer, {
    expand: ['subscriptions'],
  })

  const isDeleted = stripeCustomer.deleted
  const subscriptions = isDeleted ? [] : (stripeCustomer.subscriptions?.data ?? [])
  const allSubscriptionsInactive = subscriptions.every(
    (s) => s.status === 'canceled' || s.status === 'paused'
  )

  if (isDeleted || allSubscriptionsInactive) {
    console.error(
      `Stripe customer ${customer} is not being billed by stripe. ` +
      `Skipping usage report for customer DID: ${usage.customer}, ` +
      `space: ${usage.space}, provider: ${usage.provider}, ` +
      `period: ${usage.from.toISOString()} - ${usage.to.toISOString()}. ` +
      `Manual review required.`
    )
    return { ok: { shouldBill: false, stripeId: customer } }
  }

  const hasPastDue = subscriptions.some((s) => s.status === 'past_due')
  if (hasPastDue) {
    console.warn(
      `Stripe customer ${customer} (customer DID: ${usage.customer}) has past-due subscription(s). ` +
      `Usage will still be reported but requires manual intervention for resource collection.`
    )
  }

  return { ok: { shouldBill: true, stripeId: customer } }
}

/**
 * Reports usage to Stripe. Note we use an `idempotencyKey` but this is only
 * retained by Stripe for 24 hours. Thus, retries should not be attempted for
 * the same usage record after 24 hours. The default DynamoDB stream retention
 * is 24 hours so this should be fine for intermittent failures.
 *
 * @param {import('../lib/api.js').Usage} usage
 * @param {{ stripe: Stripe, usageStore: import('../lib/api.js').UsageStore, spaceSnapshotStore: import('../lib/api.js').SpaceSnapshotStore }} ctx
 * @returns {Promise<import('@ucanto/interface').Result<import('@ucanto/interface').Unit>>}
 */
export const reportUsage = async (usage, ctx) => {

  if (usage.space === 'did:key:z6Mkj8ynPJNkKc1e6S9VXpVDfQd8M1bPxZTgDg2Uhhjt9LoV') {
    console.log('not reporting usage for space: did:key:z6Mkj8ynPJNkKc1e6S9VXpVDfQd8M1bPxZTgDg2Uhhjt9LoV')
    return { ok: {} }
  }

  const usageContext = {
    space: usage.space,
    provider: usage.provider,
    customer: usage.customer,
    account: usage.account,
    product: usage.product,
    usage: usage.usage.toString(),
    period: {
      from: usage.from.toISOString(),
      to: usage.to.toISOString()
    }
  }

  console.log(`Processing usage...\n${JSON.stringify(usageContext)}`)

  const duration = usage.to.getTime() - usage.from.getTime()

  // Validate billing period duration
  if (duration <= 0) {
    return {
      error: new Error(
        `Invalid billing period: duration=${duration}ms, from=${usage.from.toISOString()}, to=${usage.to.toISOString()}`
      )
    }
  }
  
  // Validate Stripe customer and check if billing should proceed
  const validationResult = await validateStripeCustomerForBilling(usage, ctx)
  if (validationResult.error) return validationResult
  if (!validationResult.ok?.shouldBill) return { ok: {} }

  const stripeCustomerId = validationResult.ok?.stripeId

  // Get previous cumulative usage (handles first-of-month reset internally)
  let previousUsageResult
  try {
    previousUsageResult = await findPreviousUsageBySnapshotDate({
      customer: usage.customer,
      space: usage.space,
      provider: usage.provider,
      targetDate: usage.from
    }, ctx)

    if (!previousUsageResult.found) {
      // Check if this is a new space or data loss by querying snapshot table
      const snapshotCheck = await ctx.spaceSnapshotStore.get({
        space: usage.space,
        provider: usage.provider,
        recordedAt: usage.from
      })

      if (snapshotCheck.ok) {
        // Snapshot exists at 'from' date → billing previously occurred → usage record should exist → data loss
        console.error(
          `Critical: Missing usage record for space ${usage.space} (provider: ${usage.provider}). ` +
          `Snapshot exists at ${usage.from.toISOString()} but no corresponding usage record found. ` +
          `This indicates data loss between ${usage.from.toISOString()} and ${usage.to.toISOString()}.`
        )
        throw new Error(
          `Critical: Cannot calculate usage delta for space ${usage.space} (provider: ${usage.provider}). ` +
          `Missing usage record indicates data loss.`
        )
      }

      if (snapshotCheck.error && snapshotCheck.error.name !== 'RecordNotFound') {
        throw snapshotCheck.error
      }

      // No snapshot at 'from' date → new space, first billing period
      console.log(
        `New space detected: ${usage.space} (provider: ${usage.provider}). ` +
        `First billing period ${usage.from.toISOString()} - ${usage.to.toISOString()}.`
      )
      // Continue with previousCumulativeUsage = 0n
    }
  } catch (/** @type {any} */ err) {
    return { error: err }
  }

  const previousCumulativeUsage = previousUsageResult.usage

  const {
    cumulativeByteQuantity,
    previousCumulativeByteQuantity,
    deltaByteQuantity,
    deltaGibQuantity
  } = calculateDeltaMetrics(usage.usage, usage.from, usage.to, previousCumulativeUsage)

  if (previousCumulativeUsage === 0n && previousUsageResult.found) {
    console.log(`First of month reset or zero usage - reporting full cumulative average as delta`, JSON.stringify({customer: usageContext.customer, space: usageContext.space}))
  } else if (previousCumulativeUsage === 0n && !previousUsageResult.found) {
    console.log(`No previous usage found - reporting full cumulative average as delta`, JSON.stringify({customer: usageContext.customer, space: usageContext.space}))
  } else {
    console.log('Delta calculation inspect:', JSON.stringify({
      space: usageContext.space,
      previousCumulativeUsage: previousCumulativeUsage.toString(),
      previousCumulativeAverage: previousCumulativeByteQuantity,
      currentCumulativeUsage: usage.usage.toString(),
      currentCumulativeAverage: cumulativeByteQuantity,
      deltaBytes: deltaByteQuantity
    }))
  }

  const usageSummary = {
    space: usage.space,
    customer: usage.customer,
    cumulative: {
      bytesAverage: cumulativeByteQuantity,  // Average bytes from month start to now
      byteMs: usage.usage.toString()
    },
    delta: {
      bytes: deltaByteQuantity,  // Delta between current and previous cumulative averages
      gib: deltaGibQuantity
    }
  }
  console.log(`Usage summary:\n ${JSON.stringify(usageSummary)}`)

  const idempotencyKey = await createIdempotencyKey(usage)
  // Subtract 1 minute from the 'to' date to ensure the timestamp falls within the correct billing month.
  // If 'to' is the first day of the next month (e.g., Mar 1 00:00), we want the timestamp to be in the previous month (Feb 28 23:59).
  const ONE_MINUTE_MS = 60000
  const referenceDate = new Date(usage.to.getTime() - ONE_MINUTE_MS)

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
      stripe_customer_id: stripeCustomerId,
      bytes: deltaByteQuantity.toString(),
    },
  })

  console.log(`Created Stripe billing meter event:\n${JSON.stringify(meterEvent)}`)
  return { ok: meterEvent }
}
