#!/usr/bin/env node

/**
 * Get all spaces egress for a customer in a month from the egress-traffic-monthly table
 * and compare with the egress value on Stripe.
 *
 * Optionally, calculate egress from raw events table for verification. (expensive and long operation)
 */

import all from 'p-all'
import dotenv from 'dotenv'
import Stripe from 'stripe'
import { mustGetEnv } from '../../../lib/env.js'
import { createEgressTrafficMonthlyStore } from '../../tables/egress-traffic-monthly.js'
import { createCustomerStore } from '../../tables/customer.js'
import { createSubscriptionStore } from '../../tables/subscription.js'
import { createConsumerStore } from '../../tables/consumer.js'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { createEgressTrafficEventStore } from '../../tables/egress-traffic.js'

dotenv.config({ path: '.env.local' })

const STORACHA_ENV = mustGetEnv('STORACHA_ENV')
const STRIPE_API_KEY = mustGetEnv('STRIPE_API_KEY')

const CUSTOMER_TABLE_NAME = `${STORACHA_ENV}-w3infra-customer`
const EGRESS_MONTHLY_TABLE_NAME = `${STORACHA_ENV}-w3infra-egress-traffic-monthly`
const EGRESS_TRAFFIC_TABLE_NAME = `${STORACHA_ENV}-w3infra-egress-traffic-events`
const SUBSCRIPTION_TABLE_NAME = `${STORACHA_ENV}-w3infra-subscription`
const CONSUMER_TABLE_NAME = `${STORACHA_ENV}-w3infra-consumer`

const STRIPE_BILLING_EVENT = {
  name: 'gateway-egress-traffic',
  id: 'mtr_61RVvCPLAzHVlA84841F6A5ufQX5v4am'
}
const CONCURRENCY = 5

const stripe = new Stripe(STRIPE_API_KEY)

const dynamo = new DynamoDBClient()

const customerStore = createCustomerStore(dynamo, { tableName: CUSTOMER_TABLE_NAME })
const monthlyStore = createEgressTrafficMonthlyStore(dynamo, { tableName: EGRESS_MONTHLY_TABLE_NAME })
const trafficStore = createEgressTrafficEventStore(dynamo, { tableName: EGRESS_TRAFFIC_TABLE_NAME })
const subscriptionStore = createSubscriptionStore(dynamo, { tableName: SUBSCRIPTION_TABLE_NAME })
const consumerStore = createConsumerStore(dynamo, { tableName: CONSUMER_TABLE_NAME })

/**
 * Get customer egress information from monthly aggregation table and compare with Stripe.
 * Optionally calculate from raw events for verification.
 *
 * @param {object} params
 * @param {string} params.customer - Customer DID (did:mailto:...)
 * @param {string} params.month - Month in YYYY-MM format
 * @param {boolean} [params.calculateFromRaw=false] - Whether to also calculate from raw events table
 */
async function getCustomerEgressInfo({ customer, month, calculateFromRaw = false }) {
  console.log(`Reading egress events for ${customer} from ${month}`)
  console.log(`Environment: ${STORACHA_ENV}\n`)

  // Get monthly aggregates
  const info = await monthlyStore.listByCustomer(customer, month)
  if (info.error) throw info.error

  console.log('Monthly aggregation table:')
  console.log(`  Spaces: ${info.ok.spaces.length}`)
  console.log(`  Total bytes: ${info.ok.total.toLocaleString()}`)
  info.ok.spaces.forEach(s => {
    console.log(`    - ${s.space}: ${s.bytes.toLocaleString()} bytes (${s.eventCount} events)`)
  })
  console.log()

  // Get customer Stripe account
  const { ok: record, error } = await customerStore.get({
    customer: /** @type {`did:mailto:${string}`} */ (customer)
  })
  if (error) throw error
  if (!record.account) {
    console.error('Customer does not have associated stripe account')
    return
  }

  const stripeCustomerId = record.account.replace('stripe:', '')

  // Calculate time period for the month
  const from = new Date(`${month}-01`)
  const to = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 0, 23, 59, 59, 999))

  // Get Stripe meter events
  const totalAggregatedEvents = await stripe.billing.meters.listEventSummaries(STRIPE_BILLING_EVENT.id, {
    customer: stripeCustomerId,
    start_time: Math.floor(from.getTime() / 1000),
    end_time: Math.floor(to.getTime() / 1000),
  })

  const stripeTotal = totalAggregatedEvents.data.reduce((sum, event) => sum + event.aggregated_value, 0)

  console.log(`Stripe total aggregated usage: ${stripeTotal.toLocaleString()} bytes`)
  console.log()

  // Optionally calculate from raw events
  let rawTotal
  if (calculateFromRaw) {
    console.log('Calculating from raw events table...')
    const rawResult = await aggregateCustomerEgressFromRawEvents(customer, from, to)
    if (rawResult) {
      rawTotal = rawResult.total
      console.log(`Raw events table total: ${rawTotal.toLocaleString()} bytes`)
      console.log(`  Spaces processed: ${rawResult.spaces.length}`)
      rawResult.spaces.forEach(s => {
        if (s.bytes > 0) {
          console.log(`    - ${s.space}: ${s.bytes.toLocaleString()} bytes`)
        }
      })
      console.log()
    }
  }

  // Comparison
  console.log('='.repeat(70))
  console.log('COMPARISON RESULTS:')
  console.log('='.repeat(70))
  console.log(`Monthly aggregation table: ${info.ok.total.toLocaleString()} bytes`)
  console.log(`Stripe billing:            ${stripeTotal.toLocaleString()} bytes`)
  if (calculateFromRaw && rawTotal !== undefined) {
    console.log(`Raw events table:          ${rawTotal.toLocaleString()} bytes`)
  }
  console.log()

  // Analysis
  const monthlyVsStripe = info.ok.total - stripeTotal
  const monthlyVsStripePct = stripeTotal > 0 ? ((monthlyVsStripe / stripeTotal) * 100).toFixed(2) : 'N/A'

  if (monthlyVsStripe !== 0) {
    console.log(`⚠️  Monthly aggregation differs from Stripe by ${monthlyVsStripe.toLocaleString()} bytes (${monthlyVsStripePct}%)`)
    if (monthlyVsStripe > 0) {
      console.log('    → Monthly table is OVER-counted (possible duplicate event processing)')
    } else {
      console.log('    → Monthly table is UNDER-counted (possible missing events)')
    }
  } else {
    console.log(`✅ Monthly aggregation matches Stripe perfectly!`)
  }

  if (calculateFromRaw && rawTotal !== undefined) {
    const rawVsStripe = rawTotal - stripeTotal
    const rawVsStripePct = stripeTotal > 0 ? ((rawVsStripe / stripeTotal) * 100).toFixed(2) : 'N/A'
    const monthlyVsRaw = info.ok.total - rawTotal
    const monthlyVsRawPct = rawTotal > 0 ? ((monthlyVsRaw / rawTotal) * 100).toFixed(2) : 'N/A'

    console.log()
    if (rawVsStripe !== 0) {
      console.log(`⚠️  Raw events differ from Stripe by ${rawVsStripe.toLocaleString()} bytes (${rawVsStripePct}%)`)
    } else {
      console.log(`✅ Raw events match Stripe perfectly!`)
    }

    console.log()
    if (monthlyVsRaw !== 0) {
      console.log(`⚠️  Monthly aggregation differs from raw events by ${monthlyVsRaw.toLocaleString()} bytes (${monthlyVsRawPct}%)`)
      if (monthlyVsRaw > 0) {
        console.log('    → Monthly aggregation is OVER-counted compared to raw events')
        console.log('    → This indicates duplicate event processing in monthly aggregates')
      } else {
        console.log('    → Monthly aggregation is UNDER-counted compared to raw events')
        console.log('    → This indicates missing aggregation of some raw events')
      }
    } else {
      console.log(`✅ Monthly aggregation matches raw events perfectly!`)
    }
  }

  console.log('='.repeat(70))
}

/**
 * Aggregate customer egress from raw events table.
 * Queries all spaces associated with the customer and sums their egress traffic.
 *
 * @param {string} customer - Customer DID (did:mailto:...)
 * @param {Date} from - Start date (inclusive)
 * @param {Date} to - End date (inclusive)
 * @returns {Promise<{spaces: Array<{space: string, bytes: number}>, total: number} | undefined>}
 */
async function aggregateCustomerEgressFromRawEvents(customer, from, to) {
  // Get all spaces for the customer
  const spaceProviderMap = await getAllCustomerSpaces(customer)
  if (!spaceProviderMap) {
    console.error('Failed to get spaces')
    return
  }

  console.log(`  Found ${spaceProviderMap.size} spaces`)

  const now = new Date()
  const toMax = to.getTime() > now.getTime() ? now : to

  let total = 0
  /** @type {Array<{space: string, bytes: number}>} */
  const spaces = []

  // Sum egress for each space in parallel
  await all(
    Array.from(spaceProviderMap.entries()).map(([space,]) => async () => {
      const spaceEgressResult = await trafficStore.sumBySpace(
        /** @type {`did:${string}:${string}`} */ (space),
        { from, to: toMax },
      )

      if (spaceEgressResult.error) {
        console.error(`  Failed to sum egress for space ${space}: ${spaceEgressResult.error}`)
        return
      }

      spaces.push({ space, bytes: spaceEgressResult.ok })
      total += spaceEgressResult.ok
    }),
    { concurrency: CONCURRENCY }
  )

  return { spaces, total }
}

/**
 * Get all spaces (consumers) associated with a customer by querying subscriptions.
 *
 * @param {string} customer - Customer DID (did:mailto:...)
 * @returns {Promise<Map<string, string> | undefined>} Map of space DID → provider DID, or undefined on error
 */
async function getAllCustomerSpaces(customer) {
  /** @type {Map<string, string>} space DID -> provider DID */
  const spaceProviderMap = new Map()

  // Get spaces from subscription store with cursor-based pagination
  /** @type {string | undefined} */
  let subsCursor

  while (true) {
    const subscriptionList = await subscriptionStore.list(
      { customer: /** @type {`did:mailto:${string}`} */ (customer) },
      { cursor: subsCursor }
    )

    if (subscriptionList.error) {
      const errorMsg = `Failed to list subscriptions for ${customer}: ${subscriptionList.error}`
      console.error(errorMsg)
      return
    }

    // For each subscription, get the consumer (space)
    for (const sub of subscriptionList.ok.results) {
      const consumerGet = await consumerStore.get({
        subscription: sub.subscription,
        provider: sub.provider
      })

      if (consumerGet.error) {
        // Warn but continue - some subscriptions might not have consumers yet
        console.warn(
          `  Could not get consumer for subscription ${sub.subscription}: ${consumerGet.error.name}`
        )
        continue
      }

      spaceProviderMap.set(consumerGet.ok.consumer, sub.provider)
    }

    // Check if there are more pages
    if (!subscriptionList.ok.cursor) break
    subsCursor = subscriptionList.ok.cursor
  }

  return spaceProviderMap
}

// CLI parsing
const args = process.argv.slice(2)
const customer = args.find((e) => e.startsWith('customer='))?.split('customer=')[1]
const month = args.find((e) => e.startsWith('month='))?.split('month=')[1]
const calculateFromRaw = args.includes('--calculateFromRaw')

if (!customer || !month) {
  console.error('Usage: node 3-get-customer-egress-from-monthly-table.js customer=did:mailto:example.com:alice month=yyyy-mm [--calculateFromRaw]')
  console.error('')
  console.error('Options:')
  console.error('  --calculateFromRaw  - Also calculate egress from raw events table for verification (expensive and long operation)')
  process.exit(1)
}

try {
  await getCustomerEgressInfo({ customer, month, calculateFromRaw })
} catch (/** @type {any} */ err) {
  console.error('Fatal error:', err)
  process.exit(1)
}
