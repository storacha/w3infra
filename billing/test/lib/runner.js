import { handleCronTick } from '../../lib/runner.js'
import { randomCustomer } from '../helpers/customer.js'
import { collectQueueMessages } from '../helpers/queue.js'

/** @type {import('./api').TestSuite} */
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
      assert.equal(instruction.from.getUTCFullYear(), now.getUTCFullYear())
      assert.equal(instruction.from.getUTCMonth(), now.getUTCMonth())
      assert.equal(instruction.from.getUTCDate(), 1)
      assert.equal(instruction.from.getUTCHours(), 0)
      assert.equal(instruction.from.getUTCMinutes(), 0)
      assert.equal(instruction.from.getUTCSeconds(), 0)
      assert.equal(instruction.from.getUTCMilliseconds(), 0)

      // the expected "to" date is the "from" date + 1 month
      const to = new Date(instruction.from.toISOString())
      to.setUTCMonth(instruction.from.getUTCMonth() + 1)
      assert.equal(instruction.to.toISOString(), to.toISOString())
    }

    // ensure we got a billing instruction for each customer
    for (const c of customers) {
      assert.ok(collected.ok.some(cbi => cbi.customer === c.customer))
    }
  }
}
