import { startOfYesterday, startOfToday } from '../../lib/util.js'
import { enqueueCustomerBillingInstructions, enqueueSingleCustomerBillingInstruction } from '../../lib/billing-cron.js'
import { randomCustomer } from '../helpers/customer.js'
import { collectQueueMessages } from '../helpers/queue.js'

/** @type {import('./api.js').TestSuite<import('./api.js').BillingCronTestContext>} */
export const test = {
  'should queue all the customers': async (/** @type {import('entail').assert} */ assert, ctx) => {
    const customers = []
    for (let i = 0; i < 1100; i++) {
      const customer = randomCustomer()
      const { error } = await ctx.customerStore.put(customer)
      assert.ok(!error)
      customers.push(customer)
    }

    const noAccountCustomer = randomCustomer({ account: undefined })
    const { error } = await ctx.customerStore.put(noAccountCustomer)
    assert.ok(!error)

    const now = new Date()
    const period = { from: startOfYesterday(now), to: startOfToday(now) }
    const handled = await enqueueCustomerBillingInstructions(period, ctx)
    assert.ok(handled.ok)

    const collected = await collectQueueMessages(ctx.customerBillingQueue)
    assert.ok(collected.ok)
    assert.equal(collected.ok.length, customers.length)

    for (const instruction of collected.ok) {
      assert.equal(instruction.from.getTime(), period.from.getTime())
      assert.equal(instruction.to.getTime(), period.to.getTime())
    }

    // ensure we got a billing instruction for each customer
    for (const c of customers) {
      assert.ok(collected.ok.some(cbi => cbi.customer === c.customer))
    }

    // ensure we didn't get a billing instruction for customer with no account
    assert.ok(collected.ok.every(cbi => cbi.customer !== noAccountCustomer.customer))
  },

  'should queue single customer when customer parameter is provided': async (/** @type {import('entail').assert} */ assert, ctx) => {
    const customer = randomCustomer()
    const { error: putError } = await ctx.customerStore.put(customer)
    assert.ok(!putError)

    // Add another customer to ensure only the specified one is queued
    const otherCustomer = randomCustomer()
    const { error: otherPutError } = await ctx.customerStore.put(otherCustomer)
    assert.ok(!otherPutError)

    const now = new Date()
    const period = { from: startOfYesterday(now), to: startOfToday(now) }
    const handled = await enqueueSingleCustomerBillingInstruction(customer.customer, period, ctx)
    assert.ok(handled.ok)

    const collected = await collectQueueMessages(ctx.customerBillingQueue)
    assert.ok(collected.ok)
    assert.equal(collected.ok.length, 1)

    const instruction = collected.ok[0]
    assert.equal(instruction.customer, customer.customer)
    assert.equal(instruction.account, customer.account)
    assert.equal(instruction.product, customer.product)
    assert.equal(instruction.from.getTime(), period.from.getTime())
    assert.equal(instruction.to.getTime(), period.to.getTime())
  },

  'should return error when single customer does not exist': async (/** @type {import('entail').assert} */ assert, ctx) => {
    const nonExistentCustomer = 'did:mailto:example.com:nonexistent'
    const now = new Date()
    const period = { from: startOfYesterday(now), to: startOfToday(now) }

    const result = await enqueueSingleCustomerBillingInstruction(nonExistentCustomer, period, ctx)
    assert.ok(result.error)
    assert.equal(/** @type Error */(result.error).name, 'RecordNotFound')
  },

  'should return error when single customer does not have account': async (/** @type {import('entail').assert} */ assert, ctx) => {
    const noAccountCustomer = randomCustomer({ account: undefined })
    const { error: putError } = await ctx.customerStore.put(noAccountCustomer)
    assert.ok(!putError)

    const now = new Date()
    const period = { from: startOfYesterday(now), to: startOfToday(now) }

    const result = await enqueueSingleCustomerBillingInstruction(noAccountCustomer.customer, period, ctx)
    assert.ok(result.error)
    assert.ok(/** @type Error */ (result.error).message.includes('MissingAccount'))
  }
}
