/**
 * Perform a dry run of the billing pipeline, printing out a report of the
 * usage per customer/space.
 */
import dotenv from 'dotenv'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import * as CSV from 'csv-stringify/sync'
import fs from 'node:fs'
import all from 'p-all'
import { startOfMonth } from '../../lib/util.js'
import {
  calculateCost,
  createMemoryQueue,
  createMemoryStore,
  toDateString
} from './helpers.js'
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
import * as Usage from '../../data/usage.js'
import * as SpaceSnapshot from '../../data/space-snapshot.js'
import { mustGetEnv } from '../../../lib/env.js'
import { parseArgs } from '../utils.js'

/** @typedef {import('../../lib/api.js').Usage & import('../../lib/api.js').SpaceSnapshot} UsageAndSnapshot */

dotenv.config({ path: '.env.local' })

const concurrency = 5

const STORACHA_ENV = mustGetEnv('STORACHA_ENV')
const CUSTOMER_TABLE_NAME=`${STORACHA_ENV}-w3infra-customer`
const SUBSCRIPTION_TABLE_NAME=`${STORACHA_ENV}-w3infra-subscription`
const CONSUMER_TABLE_NAME=`${STORACHA_ENV}-w3infra-consumer`
const SPACE_DIFF_TABLE_NAME = `${STORACHA_ENV}-w3infra-space-diff`
const SPACE_SNAPSHOT_TABLE_NAME = `${STORACHA_ENV}-w3infra-space-snapshot`

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
const usageStore = createMemoryStore()
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
          })
        )

        expect(
          await SpaceBillingQueue.storeSpaceUsage(instruction, usage, {
            spaceSnapshotStore: writableSpaceSnapshotStore,
            usageStore,
          })
        )
      }),
      { concurrency }
    )
  }),
  { concurrency }
)

console.log(`✅ Billing run completed successfully`)

const { results: usages } = expect(await usageStore.list({}))
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

await fs.promises.writeFile(
  `./usage-${fileID}.json`,
  JSON.stringify(
    usageSnapshots.map((r) => ({
      ...Usage.encode(r).ok,
      ...SpaceSnapshot.encode(r).ok,
    }))
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

/** @type {Array<[string, string, string, number]>} */
const data = []
const duration = to.getTime() - from.getTime()

for (const [customer, usages] of usageByCustomer.entries()) {
  let product
  let size = 0n
  let totalUsage = 0n
  for (const u of usages) {
    product = product ?? u.product
    size += u.size
    totalUsage += u.usage
  }
  if (!product) throw new Error('missing product')
  try {
    data.push([
      customer,
      product,
      size.toString(),
      calculateCost(product, totalUsage, duration),
    ])
  } catch (err) {
    console.warn(`failed to calculate cost for: ${customer}`, err)
  }
}
data.sort((a, b) => b[3] - a[3])

await fs.promises.writeFile(
  `./summary-${fileID}.csv`,
  CSV.stringify(data, {
    header: true,
    columns: ['Customer', 'Product', 'Bytes', 'Cost ($)'],
  })
)
