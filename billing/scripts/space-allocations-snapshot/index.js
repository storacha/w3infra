import all from 'p-all'
import fs from 'node:fs'
import dotenv from 'dotenv'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'

import { createConsumerStore } from '../../tables/consumer.js'
import { createCustomerStore } from '../../tables/customer.js'
import { createAllocationStore } from '../../tables/allocations.js'
import { createSubscriptionStore } from '../../tables/subscription.js'

import { expect } from '../../functions/lib.js'
import { mustGetEnv } from '../../../lib/env.js'
import { createMemoryQueue } from '../dry-run/helpers.js'
import { EndOfQueue } from '../../test/helpers/queue.js'

import * as BillingCron from '../../lib/billing-cron.js'
import * as SpaceBillingQueue from '../../lib/space-billing-queue.js'
import * as CustomerBillingQueue from '../../lib/customer-billing-queue.js'

dotenv.config({ path: '.env.local' })

const concurrency = 5

const CUSTOMER_TABLE_NAME = mustGetEnv('CUSTOMER_TABLE_NAME')
const SUBSCRIPTION_TABLE_NAME = mustGetEnv('SUBSCRIPTION_TABLE_NAME')
const CONSUMER_TABLE_NAME = mustGetEnv('CONSUMER_TABLE_NAME')
const ALLOCATIONS_TABLE_NAME = mustGetEnv('ALLOCATIONS_TABLE_NAME')

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
const allocationStore = createAllocationStore(dynamo, {
  tableName: ALLOCATIONS_TABLE_NAME,
})

/** @type {import('../../lib/api.js').QueueAdder<import('../../lib/api.js').CustomerBillingInstruction> & import('../../test/lib/api.js').QueueRemover<import('../../lib/api.js').CustomerBillingInstruction>} */
const customerBillingQueue = createMemoryQueue()
/** @type {import('../../lib/api.js').QueueAdder<import('../../lib/api.js').SpaceBillingInstruction> & import('../../test/lib/api.js').QueueRemover<import('../../lib/api.js').SpaceBillingInstruction>} */
const spaceBillingQueue = createMemoryQueue()

// These dates should not matter
const from = new Date(1970, 0, 1)
const to = new Date()

/**
 * @type {import('../../lib/api.js').AllocationSnapshot}
 */
const result = {}

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

const customerBillingInstructions = []
while (true) {
  const removeResult = await customerBillingQueue.remove()
  if (removeResult.error) {
    if (removeResult.error.name === EndOfQueue.name) break
    throw removeResult.error
  }
  customerBillingInstructions.push(removeResult.ok)
}

console.log(`Getting all spaces...`)

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
        const spaceAllocation = expect(
          await SpaceBillingQueue.calculateSpaceAllocation(instruction, {
            allocationStore,
          })
        )

        if (!result[instruction.customer]) {
          result[instruction.customer] = {
            spaceAllocations: [],
            totalAllocation: 0n,
          }
        }

        result[instruction.customer].spaceAllocations.push({
          [instruction.space]: spaceAllocation.size,
        })
        result[instruction.customer].totalAllocation += spaceAllocation.size
      }),
      { concurrency }
    )
  }),
  { concurrency }
)

console.log(`✅ Allocation snapshot completed successfully`)

/** @param {Date} d */
const toDateString = (d) => d.toISOString().split('T')[0]

await fs.promises.writeFile(
  `./allocation-snapshot-${toDateString(to)}.json`,
  JSON.stringify(
    result,
    (key, value) => (typeof value === 'bigint' ? value.toString() : value) // return everything else unchanged
  )
)
