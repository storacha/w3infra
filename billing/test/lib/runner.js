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

    const handled = await handleCronTick(ctx)
    assert.ok(handled.ok)

    const collected = await collectQueueMessages(ctx.customerBillingQueue)
    assert.ok(collected.ok)
    assert.equal(collected.ok.length, customers.length)

    for (const instruction of collected.ok) {
      // TODO: check to/from date
    }

    // ensure we got a billing instruction for each customer
    for (const c of customers) {
      assert.ok(collected.ok.some(cbi => cbi.customer === c.customer))
    }
  }
}
