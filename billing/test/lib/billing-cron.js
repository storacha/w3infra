import { handleCronTick } from '../../lib/billing-cron.js'
import { randomCustomer } from '../helpers/customer.js'
import { collectQueueMessages } from '../helpers/queue.js'

/** @type {import('./api').TestSuite<import('./api').BillingCronTestContext>} */
export const test = {
  'should queue all the customers': async (/** @type {import('entail').assert} */ assert, ctx) => {
    const customers = []
    for (let i = 0; i < 1100; i++) {
      const customer = randomCustomer()
      const { error } = await ctx.customerStore.put(customer)
      assert.ok(!error)
      customers.push(customer)
    }

    const now = new Date()
    const handled = await handleCronTick(ctx)
    assert.ok(handled.ok)

    const collected = await collectQueueMessages(ctx.customerBillingQueue)
    assert.ok(collected.ok)
    assert.equal(collected.ok.length, customers.length)

    for (const instruction of collected.ok) {
      assert.equal(instruction.to.getUTCFullYear(), now.getUTCFullYear())
      assert.equal(instruction.to.getUTCMonth(), now.getUTCMonth())
      assert.equal(instruction.to.getUTCDate(), 1)
      assert.equal(instruction.to.getUTCHours(), 0)
      assert.equal(instruction.to.getUTCMinutes(), 0)
      assert.equal(instruction.to.getUTCSeconds(), 0)
      assert.equal(instruction.to.getUTCMilliseconds(), 0)

      // the expected "from" date is the "to" date - 1 month
      const from = new Date(instruction.to.toISOString())
      from.setUTCMonth(instruction.to.getUTCMonth() - 1)
      assert.equal(instruction.from.toISOString(), from.toISOString())
    }

    // ensure we got a billing instruction for each customer
    for (const c of customers) {
      assert.ok(collected.ok.some(cbi => cbi.customer === c.customer))
    }
  }
}
