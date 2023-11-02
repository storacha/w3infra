import { Schema } from '@ucanto/core'
import { findSpaceUsageDeltas, storeSpaceUsageDelta } from '../../lib/ucan-stream.js'
import { randomConsumer } from '../helpers/consumer.js'
import { randomCustomer } from '../helpers/customer.js'
import { randomLink } from '../helpers/dag.js'
import { randomDID } from '../helpers/did.js'
import { randomSubscription } from '../helpers/subscription.js'

/** @type {import('./api').TestSuite<import('./api').UCANStreamTestContext>} */
export const test = {
  'should filter UCANs': async (/** @type {import('entail').assert} */ assert, ctx) => {
    /** @type {import('../../lib/api.js').UcanStreamMessage[]} */
    const invocations = [{
      type: 'workflow',
      carCid: randomLink(),
      value: {
        att: [{
          with: await randomDID(),
          can: 'store/list'
        }],
        aud: await randomDID(),
        cid: randomLink()
      },
      ts: new Date()
    }]

    const shard = randomLink()

    /** @type {import('../../lib/api.js').UcanReceiptMessage[]} */
    const receipts = [{
      type: 'receipt',
      carCid: randomLink(),
      invocationCid: randomLink(),
      value: {
        att: [{
          with: await randomDID(),
          can: 'store/add',
          nb: {
            link: shard,
            size: 138
          }
        }],
        aud: await randomDID(),
        cid: randomLink()
      },
      out: { ok: { status: 'upload' } },
      ts: new Date()
    }, {
      type: 'receipt',
      carCid: randomLink(),
      invocationCid: randomLink(),
      value: {
        att: [{
          with: await randomDID(),
          can: 'store/remove',
          nb: { link: shard }
        }],
        aud: await randomDID(),
        cid: randomLink()
      },
      out: { ok: { size: 138 } },
      ts: new Date()
    }]

    const deltas = findSpaceUsageDeltas([...invocations, ...receipts])
    assert.equal(deltas.length, receipts.length)

    // ensure we have a delta for every receipt
    for (const r of receipts) {
      assert.ok(deltas.some(d => (
        d.resource === r.value.att[0].with &&
        d.cause.toString() === r.invocationCid.toString()
      )))
    }
  },
  'should store space diffs': async (/** @type {import('entail').assert} */ assert, ctx) => {
    const customer = randomCustomer()
    const consumer = await randomConsumer()
    const subscription = await randomSubscription({
      customer: customer.customer,
      subscription: consumer.subscription,
      provider: consumer.provider
    })

    await ctx.consumerStore.put(consumer)
    await ctx.subscriptionStore.put(subscription)

    const from = new Date()

    /** @type {import('../../lib/api.js').UcanReceiptMessage<[import('@web3-storage/capabilities/types').StoreAdd]>[]} */
    const receipts = [{
      type: 'receipt',
      carCid: randomLink(),
      invocationCid: randomLink(),
      value: {
        att: [{
          with: Schema.did({ method: 'key' }).from(consumer.consumer),
          can: 'store/add',
          nb: {
            link: randomLink(),
            size: 138
          }
        }],
        aud: consumer.provider,
        cid: randomLink()
      },
      out: { ok: { status: 'upload' } },
      ts: new Date(from.getTime() + 1)
    }, {
      type: 'receipt',
      carCid: randomLink(),
      invocationCid: randomLink(),
      value: {
        att: [{
          with: Schema.did({ method: 'key' }).from(consumer.consumer),
          can: 'store/add',
          nb: {
            link: randomLink(),
            size: 1138
          }
        }],
        aud: consumer.provider,
        cid: randomLink()
      },
      out: { ok: { status: 'upload' } },
      ts: new Date(from.getTime() + 2)
    }]

    const deltas = findSpaceUsageDeltas(receipts)

    for (const d of deltas) {
      const res = await storeSpaceUsageDelta(d, ctx)
      assert.ok(res.ok)
    }

    const res = await ctx.spaceDiffStore.list({
      customer: customer.customer,
      provider: consumer.provider,
      space: consumer.consumer,
      from
    }, { size: receipts.length })
    assert.ok(res.ok)
    assert.equal(res.ok.results.length, receipts.length)

    // ensure we have a diff for every receipt
    for (const r of receipts) {
      assert.ok(res.ok.results.some(d => (
        d.cause.toString() === r.invocationCid.toString() &&
        d.customer === customer.customer &&
        d.provider === consumer.provider &&
        d.space === r.value.att[0].with &&
        d.subscription === subscription.subscription &&
        d.delta === r.value.att[0].nb?.size
      )))
    }
  }
}
