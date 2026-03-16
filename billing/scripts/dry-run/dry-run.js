/**
 * Perform a dry run of the billing pipeline, printing out a report of the
 * usage per customer/space.
 */
import dotenv from 'dotenv'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import * as CSV from 'csv-stringify/sync'
import fs from 'node:fs'
import all from 'p-all'
import { startOfMonth, GB, toDateString } from '../../lib/util.js'
import {
  calculateCost,
  createMemoryQueue,
  createMemoryStore
} from './helpers.js'
import { calculateDeltaMetrics, findPreviousUsageBySnapshotDate } from '../../lib/usage-calculations.js'
import { EndOfQueue } from '../../test/helpers/queue.js'
import { expect } from '../../functions/lib.js'
import * as BillingCron from '../../lib/billing-cron.js'
import * as CustomerBillingQueue from '../../lib/customer-billing-queue.js'
import * as SpaceBillingQueue from '../../lib/space-billing-queue.js'
import { createCustomerStore } from '../../tables/customer.js'
import { createSubscriptionStore } from '../../tables/subscription.js'
import { createConsumerStore } from '../../tables/consumer.js'
import { createSpaceDiffStore } from '../../tables/space-diff.js'
import { createSpaceSnapshotStore } from '../../tables/space-snapshot.js'
import { createUsageStore } from '../../tables/usage.js'
import { mustGetEnv } from '../../../lib/env.js'
import { parseArgs } from '../utils.js'

/**
 * @typedef {{
 *   cumulativeByteQuantity: number,
 *   previousCumulativeByteQuantity: number,
 *   deltaByteQuantity: number,
 *   deltaGibQuantity: number,
 *   currentCumulativeDuration: number,
 *   previousCumulativeDuration: number
 * }} DeltaMetrics
 */

/** @typedef {import('../../lib/api.js').Usage & import('../../lib/api.js').SpaceSnapshot & {_deltaMetrics?: DeltaMetrics}} UsageAndSnapshot */

dotenv.config({ path: '.env.local' })

const concurrency = 5

const STORACHA_ENV = mustGetEnv('STORACHA_ENV')
const CUSTOMER_TABLE_NAME=`${STORACHA_ENV}-w3infra-customer`
const SUBSCRIPTION_TABLE_NAME=`${STORACHA_ENV}-w3infra-subscription`
const CONSUMER_TABLE_NAME=`${STORACHA_ENV}-w3infra-consumer`
const SPACE_DIFF_TABLE_NAME = `${STORACHA_ENV}-w3infra-space-diff`
const SPACE_SNAPSHOT_TABLE_NAME = `${STORACHA_ENV}-w3infra-space-snapshot`
const USAGE_TABLE_NAME = `${STORACHA_ENV}-w3infra-usage`

const dynamo = new DynamoDBClient()

const customerStore = createCustomerStore(dynamo, {
  tableName: CUSTOMER_TABLE_NAME,
})
const subscriptionStore = createSubscriptionStore(dynamo, {
  tableName: SUBSCRIPTION_TABLE_NAME,
})
const consumerStore = createConsumerStore(dynamo, {
  tableName: CONSUMER_TABLE_NAME,
})
const spaceDiffStore = createSpaceDiffStore(dynamo, {
  tableName: SPACE_DIFF_TABLE_NAME,
})
const readableSpaceSnapshotStore = createSpaceSnapshotStore(dynamo, {
  tableName: SPACE_SNAPSHOT_TABLE_NAME,
})
const readableUsageStore = createUsageStore(dynamo, {
  tableName: USAGE_TABLE_NAME,
})


/**
 *  @typedef {import('../../lib/api.js').CustomerBillingInstruction} CustomerBillingInstruction
 *  @typedef {import('../../lib/api.js').StorePutter<import('../../lib/api.js').SpaceSnapshot> & import('../../lib/api.js').StoreLister<any, import('../../lib/api.js').SpaceSnapshot> & import('../../lib/api.js').StoreGetter<any, import('../../lib/api.js').SpaceSnapshot>} SpaceSnapshotStore
 *  @typedef {import('../../lib/api.js').StorePutter<import('../../lib/api.js').Usage> & import('../../lib/api.js').StoreLister<any, import('../../lib/api.js').Usage> & import('../../lib/api.js').StoreGetter<any, import('../../lib/api.js').Usage>} UsageStore
 *  @typedef {import('../../lib/api.js').QueueAdder<import('../../lib/api.js').CustomerBillingInstruction> & import('../../test/lib/api.js').QueueRemover<import('../../lib/api.js').CustomerBillingInstruction>} CustomerBillingQueue
 *  @typedef {import('../../lib/api.js').QueueAdder<import('../../lib/api.js').SpaceBillingInstruction> & import('../../test/lib/api.js').QueueRemover<import('../../lib/api.js').SpaceBillingInstruction>} SpaceBillingQueue
 */

/** @type SpaceSnapshotStore */
const writableSpaceSnapshotStore = createMemoryStore()
/** @type UsageStore */
const writableUsageStore = createMemoryStore()
/** @type CustomerBillingQueue */
const customerBillingQueue = createMemoryQueue()
/** @type SpaceBillingQueue */
const spaceBillingQueue = createMemoryQueue()

/**
 * - `from=yyyy-mm-dd`: Start date. Defaults to the first day of the current month if not provided.
 * - `to=yyyy-mm-dd`: End date. Defaults to the first day of the next month if not provided.
 * - `customer=did:mailto:agent`: DID of the user account. Defaults to get all customers.
 */
const args = process.argv.slice(2)
const { from: fromDate, to, customer } = parseArgs(args)
const from = fromDate || (() => {
  const now = new Date()
  return startOfMonth(now) // first day of the current month
})()
const fileID = customer ? `${toDateString(from)}-${toDateString(to)}-${customer}`: `${toDateString(from)}-${toDateString(to)}`

console.log(
  `Running billing for period: ${from.toISOString()} - ${to.toISOString()}`
)

/** @type CustomerBillingInstruction[] */
const customerBillingInstructions = []

if (customer) {
  console.log(`Getting customer...`)

  const { ok: record, error } = await customerStore.get({ customer })
  if (error) throw error

  if (record.account) {
    customerBillingInstructions.push({
      customer: record.customer,
      account: record.account,
      product: record.product,
      from,
      to,
    })
  } else {
    throw new Error(
      `Customer ${customer} does not have an account. Cannot run billing.`
    )
  }
} else {
  console.log(`Getting all customers...`)

  expect(
    await BillingCron.enqueueCustomerBillingInstructions(
      { from, to },
      {
        customerStore,
        customerBillingQueue,
      }
    )
  )

  while (true) {
    const removeResult = await customerBillingQueue.remove()
    if (removeResult.error) {
      if (removeResult.error.name === EndOfQueue.name) break
      throw removeResult.error
    }
    customerBillingInstructions.push(removeResult.ok)
  }
}

await all(
  customerBillingInstructions.map((instruction) => async () => {
    expect(
      await CustomerBillingQueue.enqueueSpaceBillingInstructions(instruction, {
        subscriptionStore,
        consumerStore,
        spaceBillingQueue,
      })
    )

    const spaceBillingInstructions = []
    while (true) {
      const removeResult = await spaceBillingQueue.remove()
      if (removeResult.error) {
        if (removeResult.error.name === EndOfQueue.name) break
        throw removeResult.error
      }
      spaceBillingInstructions.push(removeResult.ok)
    }

    await all(
      spaceBillingInstructions.map((instruction) => async () => {
        const usage = expect(
          await SpaceBillingQueue.calculatePeriodUsage(instruction, {
            spaceDiffStore,
            spaceSnapshotStore: readableSpaceSnapshotStore,
            usageStore: readableUsageStore,
          })
        )

        expect(
          await SpaceBillingQueue.storeSpaceUsage(instruction, usage, {
            spaceSnapshotStore: writableSpaceSnapshotStore,
            usageStore: writableUsageStore,
          })
        )
      }),
      { concurrency }
    )
  }),
  { concurrency }
)

console.log(`✅ Billing run completed successfully`)

const { results: usages } = expect(await writableUsageStore.list({}))
const { results: snapshots } = expect(await writableSpaceSnapshotStore.list({}))

/** @type {UsageAndSnapshot[]} */
const usageSnapshots = []
for (const usage of usages) {
  const snap = snapshots.find(
    (s) =>
      s.recordedAt.getTime() === to.getTime() &&
      s.provider === usage.provider &&
      s.space === usage.space
  )
  if (!snap) throw new Error(`missing snapshot: ${usage.space}`)
  usageSnapshots.push({ ...usage, ...snap })
}

// Aggregate view keyed by customer with per-space entries and totals
/**
 * @typedef {{ size: string, usage: string, provider: string }} SpaceUsage
 * @typedef {{
 *   account: string,
 *   product: string,
 *   from: string,
 *   to: string,
 *   spaces: Array<Record<string, SpaceUsage>>,
 *   totalSize: bigint,
 *   totalUsage: bigint,
 * }} AggregatedCustomer
 */
/** @type {Record<string, AggregatedCustomer>} */
const aggregatedByCustomer = {}
for (const u of usageSnapshots) {
  const key = u.customer
  if (!aggregatedByCustomer[key]) {
    aggregatedByCustomer[key] = {
      account: u.account,
      product: u.product,
      from: from.toISOString(),
      to: to.toISOString(),
      spaces: [],
      totalSize: 0n,
      totalUsage: 0n,
    }
  } else {
    // Basic consistency check: warn if mismatched metadata for same customer
    const agg = aggregatedByCustomer[key]
    if (agg.account !== u.account) console.warn(`customer ${key} has multiple accounts: ${agg.account} vs ${u.account}`)
    if (agg.product !== u.product) console.warn(`customer ${key} has multiple products: ${agg.product} vs ${u.product}`)
  }

  aggregatedByCustomer[key].spaces.push({
    [u.space]: {
      size: u.size.toString(),
      usage: u.usage.toString(),
      provider: u.provider,
    },
  })
  aggregatedByCustomer[key].totalSize += u.size
  aggregatedByCustomer[key].totalUsage += u.usage
}

await fs.promises.writeFile(
  `./usage-${fileID}.json`,
  JSON.stringify(
    aggregatedByCustomer,
    (_key, value) => (typeof value === 'bigint' ? value.toString() : value)
  )
)

/** @type {Map<string, UsageAndSnapshot[]>} */
const usageByCustomer = new Map()
for (const usage of usageSnapshots) {
  let customerUsages = usageByCustomer.get(usage.customer)
  if (!customerUsages) {
    customerUsages = []
    usageByCustomer.set(usage.customer, customerUsages)
  }
  customerUsages.push(usage)
}

// Calculate delta metrics for each usage record (simulating what production sends to Stripe)
console.log('\n--- Delta Calculation (Production Simulation) ---')
for (const usage of usageSnapshots) {
  const previousCumulativeUsage = await findPreviousUsageBySnapshotDate({
    customer: usage.customer,
    space: usage.space,
    provider: usage.provider,
    targetDate: usage.from
  }, { usageStore: readableUsageStore })

  console.log('previousCumulativeUsage:',previousCumulativeUsage.found)

  // Calculate delta using production formula
  const delta = calculateDeltaMetrics(
    usage.usage,
    usage.from,
    usage.to,
    previousCumulativeUsage.usage
  )

  // Store delta metrics on the usage object for CSV generation
  usage._deltaMetrics = delta

  console.log(`\nSpace: ${usage.space}`)
  console.log(`  Customer: ${usage.customer}`)
  console.log(`  Date: ${usage.from.toISOString().split('T')[0]}`)
  console.log(`  Cumulative Usage: ${usage.usage} byte·ms`)
  console.log(`  Previous Cumulative: ${previousCumulativeUsage} byte·ms`)
  console.log(`  Cumulative Avg: ${delta.cumulativeByteQuantity} bytes/month`)
  console.log(`  Previous Avg: ${delta.previousCumulativeByteQuantity} bytes/month`)
  console.log(`  Delta (Stripe): ${delta.deltaByteQuantity} bytes (${delta.deltaGibQuantity.toFixed(6)} GiB)`)
  console.log(`  Would Skip: ${delta.deltaByteQuantity === 0 ? 'YES' : 'NO'}`)
}
console.log('\n--- End Delta Calculation ---\n')

/** @type {Array<[string, string, string, string, string, string, string, string, string, number]>} */
const data = []

for (const [customer, usages] of usageByCustomer.entries()) {
  let product
  let size = 0n
  let totalUsage = 0n
  let totalCumulativeByteQuantity = 0
  let totalDeltaByteQuantity = 0
  let totalDeltaGibQuantity = 0

  for (const u of usages) {
    product = product ?? u.product
    size += u.size
    totalUsage += u.usage
    // Sum the delta metrics from each space
    if (u._deltaMetrics) {
      totalCumulativeByteQuantity += u._deltaMetrics.cumulativeByteQuantity
      totalDeltaByteQuantity += u._deltaMetrics.deltaByteQuantity
      totalDeltaGibQuantity += u._deltaMetrics.deltaGibQuantity
    }
  }
  if (!product) throw new Error('missing product')
  try {
    // Use the aggregated cumulative byte quantity from delta metrics
    const usageBytesPerMonth = totalCumulativeByteQuantity
    const usageGiBPerMonth = (usageBytesPerMonth / GB).toFixed(2)
    const usageByteMs = totalUsage.toString()

    // Calculate cost using cumulative duration from month start
    const monthStart = startOfMonth(usages[0].from)
    const cumulativeDuration = usages[0].to.getTime() - monthStart.getTime()
    const stripeCustomerId = usages[0].account.replace('stripe:', '')

    data.push([
      customer,
      stripeCustomerId,
      product,
      size.toString(), // Total Size (bytes)
      usageByteMs, // Cumulative Usage (byte·ms) from month start
      usageBytesPerMonth.toString(), // Cumulative Avg (bytes/month) from delta metrics
      usageGiBPerMonth, // Cumulative Avg (GiB/month) from delta metrics
      totalDeltaByteQuantity.toString(), // Delta sent to Stripe (bytes)
      totalDeltaGibQuantity.toFixed(6), // Delta sent to Stripe (GiB)
      calculateCost(product, totalUsage, cumulativeDuration),
    ])
  } catch (err) {
    console.warn(`failed to calculate cost for: ${customer}`, err)
  }
}
// Sort by Cost ($) descending. Cost is now at index 9.
data.sort((a, b) => b[9] - a[9])

await fs.promises.writeFile(
  `./summary-${fileID}.csv`,
  CSV.stringify(data, {
    header: true,
    columns: [
      'Customer',
      'Stripe ID',
      'Product',
      'Total Size (bytes)',
      'Cumulative Usage (byte·ms)',
      'Cumulative Avg (bytes/month)',
      'Cumulative Avg (GiB/month)',
      'Delta Stripe (bytes)',
      'Delta Stripe (GiB)',
      'Cost ($)',
    ],
  })
)
