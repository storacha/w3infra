import { calculatePeriodUsage, storeSpaceUsage } from '../../lib/space-billing-queue.js'
import { startOfYesterday, startOfToday } from '../../lib/util.js'
import { randomConsumer } from '../helpers/consumer.js'
import { randomCustomer } from '../helpers/customer.js'
import { randomLink } from '../helpers/dag.js'

/** @type {import('./api.js').TestSuite<import('./api.js').SpaceBillingQueueTestContext>} */
export const test = {
  'should do basic usage calculation for new space with single item added at snapshot time': async (/** @type {import('entail').assert} */ assert, ctx) => {
    const customer = randomCustomer()
    const consumer = await randomConsumer()
    const now = new Date()
    const from = startOfYesterday(now)
    const to = startOfToday(now)
    const delta = 1024 * 1024 * 1024 // 1GiB

    await ctx.spaceDiffStore.batchPut([{
      provider: consumer.provider,
      space: consumer.consumer,
      subscription: consumer.subscription,
      cause: randomLink(),
      delta,
      receiptAt: from,
      insertedAt: new Date()
    }])

    /** @type {import('../../lib/api.js').SpaceBillingInstruction} */
    const instruction = {
      customer: customer.customer,
      account: customer.account,
      product: customer.product,
      from,
      to,
      space: consumer.consumer,
      provider: consumer.provider
    }

    const calculation = await calculatePeriodUsage(instruction, ctx)
    assert.ok(calculation.ok)

    const handled = await storeSpaceUsage(instruction, calculation.ok, ctx)
    assert.ok(handled.ok)

    const { ok: listing } = await ctx.usageStore.list({ customer: customer.customer, from })
    assert.ok(listing)

    assert.equal(listing.results.length, 1)
    assert.equal(
      listing.results[0].usage,
      // 1GiB for the whole period
      BigInt(delta) * BigInt(to.getTime() - from.getTime())
    )

    const { ok: snap } = await ctx.spaceSnapshotStore.get({
      provider: consumer.provider,
      space: consumer.consumer,
      recordedAt: to
    })
    assert.ok(snap)
    assert.equal(snap.size, BigInt(delta))
  },
  'should consider removals': async (/** @type {import('entail').assert} */ assert, ctx) => {
    const customer = randomCustomer()
    const consumer = await randomConsumer()
    const now = new Date()
    const from = startOfYesterday(now)
    const to = startOfToday(now)
    const delta = 1024 * 1024 * 1024 // 1GiB

    await ctx.spaceSnapshotStore.put({
      space: consumer.consumer,
      size: 0n,
      recordedAt: from,
      provider: consumer.provider,
      insertedAt: new Date()
    })

    await ctx.spaceDiffStore.batchPut([
      // add 1GiB
      {
        provider: consumer.provider,
        space: consumer.consumer,
        subscription: consumer.subscription,
        cause: randomLink(),
        delta,
        receiptAt: from,
        insertedAt: new Date()
      },
      // remove 1GiB
      {
        provider: consumer.provider,
        space: consumer.consumer,
        subscription: consumer.subscription,
        cause: randomLink(),
        delta: -delta,
        // removed exactly half way through the period
        receiptAt: new Date(from.getTime() + ((to.getTime() - from.getTime()) / 2)),
        insertedAt: new Date()
      }
    ])

    /** @type {import('../../lib/api.js').SpaceBillingInstruction} */
    const instruction = {
      customer: customer.customer,
      account: customer.account,
      product: customer.product,
      from,
      to,
      space: consumer.consumer,
      provider: consumer.provider
    }

    const calculation = await calculatePeriodUsage(instruction, ctx)
    assert.ok(calculation.ok)

    const handled = await storeSpaceUsage(instruction, calculation.ok, ctx)
    assert.ok(handled.ok)

    const { ok: listing } = await ctx.usageStore.list({ customer: customer.customer, from })
    assert.ok(listing)

    assert.equal(listing.results.length, 1)
    assert.equal(
      listing.results[0].usage,
      // 1GiB for half the period
      BigInt(delta) * BigInt(to.getTime() - from.getTime()) / 2n
    )

    const { ok: snap } = await ctx.spaceSnapshotStore.get({
      provider: consumer.provider,
      space: consumer.consumer,
      recordedAt: to
    })
    assert.ok(snap)
    assert.equal(snap.size, 0n)
  },
  'should consider existing space size': async (/** @type {import('entail').assert} */ assert, ctx) => {
    const customer = randomCustomer()
    const consumer = await randomConsumer()
    const size = BigInt(1024 * 1024 * 1024 * 1024) // 1TiB
    const now = new Date()
    const from = startOfYesterday(now)
    const to = startOfToday(now)
    const delta = 1024 * 1024 * 1024 // 1GiB

    await ctx.spaceSnapshotStore.put({
      space: consumer.consumer,
      size,
      recordedAt: from,
      provider: consumer.provider,
      insertedAt: new Date()
    })

    /** @param {Date} today */
    const yesterday = today => {
      const yest = new Date(today.toISOString())
      yest.setUTCDate(today.getUTCDate() - 1)
      return yest
    }

    await ctx.spaceDiffStore.batchPut([{
      provider: consumer.provider,
      space: consumer.consumer,
      subscription: consumer.subscription,
      cause: randomLink(),
      delta,
      // store/add 24h prior to end of billing
      receiptAt: yesterday(to),
      insertedAt: new Date()
    }])

    /** @type {import('../../lib/api.js').SpaceBillingInstruction} */
    const instruction = {
      customer: customer.customer,
      account: customer.account,
      product: customer.product,
      from,
      to,
      space: consumer.consumer,
      provider: consumer.provider
    }

    const calculation = await calculatePeriodUsage(instruction, ctx)
    assert.ok(calculation.ok)

    const handled = await storeSpaceUsage(instruction, calculation.ok, ctx)
    assert.ok(handled.ok)

    const { ok: listing } = await ctx.usageStore.list({ customer: customer.customer, from })
    assert.ok(listing)

    assert.equal(listing.results.length, 1)
    assert.equal(
      listing.results[0].usage,
      // existing size for the period
      size * BigInt(to.getTime() - from.getTime())
      // + 1GiB for 1 day
      + BigInt(delta) * BigInt(to.getTime() - yesterday(to).getTime())
    )

    const { ok: snap } = await ctx.spaceSnapshotStore.get({
      provider: consumer.provider,
      space: consumer.consumer,
      recordedAt: to
    })
    assert.ok(snap)
    assert.equal(snap.size, size + BigInt(delta))
  },
  'should use most recent snapshot when exact from date snapshot does not exist': async (/** @type {import('entail').assert} */ assert, ctx) => {
    const customer = randomCustomer()
    const consumer = await randomConsumer()
    const now = new Date()
    const from = startOfYesterday(now)
    const to = startOfToday(now)

    // Create a snapshot 2 days before 'from' with existing size
    const twoDaysBeforeFrom = new Date(from.getTime() - 2 * 24 * 60 * 60 * 1000)
    const existingSize = BigInt(5 * 1024 * 1024 * 1024) // 5GiB

    await ctx.spaceSnapshotStore.put({
      space: consumer.consumer,
      size: existingSize,
      recordedAt: twoDaysBeforeFrom,
      provider: consumer.provider,
      insertedAt: new Date()
    })

    // Add a diff between the old snapshot and 'from'
    const oneDayBeforeFrom = new Date(from.getTime() - 24 * 60 * 60 * 1000)
    const deltaBefore = 1024 * 1024 * 1024 // 1GiB added before period starts

    await ctx.spaceDiffStore.batchPut([{
      provider: consumer.provider,
      space: consumer.consumer,
      subscription: consumer.subscription,
      cause: randomLink(),
      delta: deltaBefore,
      receiptAt: oneDayBeforeFrom,
      insertedAt: new Date()
    }])

    // Add a diff during the billing period
    const deltaInPeriod = 2 * 1024 * 1024 * 1024 // 2GiB
    await ctx.spaceDiffStore.batchPut([{
      provider: consumer.provider,
      space: consumer.consumer,
      subscription: consumer.subscription,
      cause: randomLink(),
      delta: deltaInPeriod,
      receiptAt: from,
      insertedAt: new Date()
    }])

    /** @type {import('../../lib/api.js').SpaceBillingInstruction} */
    const instruction = {
      customer: customer.customer,
      account: customer.account,
      product: customer.product,
      from,
      to,
      space: consumer.consumer,
      provider: consumer.provider
    }

    const calculation = await calculatePeriodUsage(instruction, ctx)
    assert.ok(calculation.ok)

    // Size at 'from' should be: existingSize (5GiB) + deltaBefore (1GiB) = 6GiB
    const sizeAtFrom = existingSize + BigInt(deltaBefore)
    // Final size should be: sizeAtFrom (6GiB) + deltaInPeriod (2GiB) = 8GiB
    const expectedFinalSize = sizeAtFrom + BigInt(deltaInPeriod)

    // Usage calculation:
    // 6GiB for whole period + 2GiB for whole period (since added at 'from')
    // = (6GiB + 2GiB) * period_duration (but 2GiB added at 'from', so it's 6GiB for full period + 2GiB for full period)
    // Actually: 6GiB * period + 2GiB * (to - from) = 8GiB * period
    const expectedUsage = expectedFinalSize * BigInt(to.getTime() - from.getTime())

    assert.equal(calculation.ok.size, expectedFinalSize)
    assert.equal(calculation.ok.usage, expectedUsage)

    const handled = await storeSpaceUsage(instruction, calculation.ok, ctx)
    assert.ok(handled.ok)

    const { ok: snap } = await ctx.spaceSnapshotStore.get({
      provider: consumer.provider,
      space: consumer.consumer,
      recordedAt: to
    })
    assert.ok(snap)
    assert.equal(snap.size, expectedFinalSize)
  },
  'should replay diffs between old snapshot and from date': async (/** @type {import('entail').assert} */ assert, ctx) => {
    const customer = randomCustomer()
    const consumer = await randomConsumer()
    const now = new Date()
    const from = startOfYesterday(now)
    const to = startOfToday(now)

    // Create a snapshot 3 days before 'from'
    const threeDaysBeforeFrom = new Date(from.getTime() - 3 * 24 * 60 * 60 * 1000)
    const snapshotSize = BigInt(10 * 1024 * 1024 * 1024) // 10GiB

    await ctx.spaceSnapshotStore.put({
      space: consumer.consumer,
      size: snapshotSize,
      recordedAt: threeDaysBeforeFrom,
      provider: consumer.provider,
      insertedAt: new Date()
    })

    // Multiple diffs between snapshot and 'from'
    const twoDaysBeforeFrom = new Date(from.getTime() - 2 * 24 * 60 * 60 * 1000)
    const oneDayBeforeFrom = new Date(from.getTime() - 24 * 60 * 60 * 1000)

    await ctx.spaceDiffStore.batchPut([
      {
        provider: consumer.provider,
        space: consumer.consumer,
        subscription: consumer.subscription,
        cause: randomLink(),
        delta: 2 * 1024 * 1024 * 1024, // +2GiB
        receiptAt: twoDaysBeforeFrom,
        insertedAt: new Date()
      },
      {
        provider: consumer.provider,
        space: consumer.consumer,
        subscription: consumer.subscription,
        cause: randomLink(),
        delta: -3 * 1024 * 1024 * 1024, // -3GiB
        receiptAt: oneDayBeforeFrom,
        insertedAt: new Date()
      }
    ])

    // Add a diff during the billing period
    const deltaInPeriod = 1024 * 1024 * 1024 // 1GiB
    await ctx.spaceDiffStore.batchPut([{
      provider: consumer.provider,
      space: consumer.consumer,
      subscription: consumer.subscription,
      cause: randomLink(),
      delta: deltaInPeriod,
      receiptAt: from,
      insertedAt: new Date()
    }])

    /** @type {import('../../lib/api.js').SpaceBillingInstruction} */
    const instruction = {
      customer: customer.customer,
      account: customer.account,
      product: customer.product,
      from,
      to,
      space: consumer.consumer,
      provider: consumer.provider
    }

    const calculation = await calculatePeriodUsage(instruction, ctx)
    assert.ok(calculation.ok)

    // Size at 'from' should be: 10GiB + 2GiB - 3GiB = 9GiB
    const sizeAtFrom = BigInt(9 * 1024 * 1024 * 1024)
    // Final size should be: 9GiB + 1GiB = 10GiB
    const expectedFinalSize = sizeAtFrom + BigInt(deltaInPeriod)

    assert.equal(calculation.ok.size, expectedFinalSize)

    const handled = await storeSpaceUsage(instruction, calculation.ok, ctx)
    assert.ok(handled.ok)

    const { ok: snap } = await ctx.spaceSnapshotStore.get({
      provider: consumer.provider,
      space: consumer.consumer,
      recordedAt: to
    })
    assert.ok(snap)
    assert.equal(snap.size, expectedFinalSize)
  },
  'should handle multiple old snapshots and use most recent one': async (/** @type {import('entail').assert} */ assert, ctx) => {
    const customer = randomCustomer()
    const consumer = await randomConsumer()
    const now = new Date()
    const from = startOfYesterday(now)
    const to = startOfToday(now)

    // Create multiple snapshots before 'from'
    const fiveDaysBeforeFrom = new Date(from.getTime() - 5 * 24 * 60 * 60 * 1000)
    const threeDaysBeforeFrom = new Date(from.getTime() - 3 * 24 * 60 * 60 * 1000)
    const oneDayBeforeFrom = new Date(from.getTime() - 24 * 60 * 60 * 1000)

    await ctx.spaceSnapshotStore.put({
      space: consumer.consumer,
      size: BigInt(5 * 1024 * 1024 * 1024),
      recordedAt: fiveDaysBeforeFrom,
      provider: consumer.provider,
      insertedAt: new Date()
    })

    await ctx.spaceSnapshotStore.put({
      space: consumer.consumer,
      size: BigInt(8 * 1024 * 1024 * 1024),
      recordedAt: threeDaysBeforeFrom,
      provider: consumer.provider,
      insertedAt: new Date()
    })

    // Most recent snapshot before 'from' - this should be used
    const mostRecentSize = BigInt(12 * 1024 * 1024 * 1024) // 12GiB
    await ctx.spaceSnapshotStore.put({
      space: consumer.consumer,
      size: mostRecentSize,
      recordedAt: oneDayBeforeFrom,
      provider: consumer.provider,
      insertedAt: new Date()
    })

    // Add a diff during the period
    const deltaInPeriod = 3 * 1024 * 1024 * 1024 // 3GiB
    await ctx.spaceDiffStore.batchPut([{
      provider: consumer.provider,
      space: consumer.consumer,
      subscription: consumer.subscription,
      cause: randomLink(),
      delta: deltaInPeriod,
      receiptAt: from,
      insertedAt: new Date()
    }])

    /** @type {import('../../lib/api.js').SpaceBillingInstruction} */
    const instruction = {
      customer: customer.customer,
      account: customer.account,
      product: customer.product,
      from,
      to,
      space: consumer.consumer,
      provider: consumer.provider
    }

    const calculation = await calculatePeriodUsage(instruction, ctx)
    assert.ok(calculation.ok)

    // Should use the most recent snapshot (12GiB)
    const expectedFinalSize = mostRecentSize + BigInt(deltaInPeriod)
    assert.equal(calculation.ok.size, expectedFinalSize)

    const handled = await storeSpaceUsage(instruction, calculation.ok, ctx)
    assert.ok(handled.ok)
  },
  'should not use future snapshots even if they exist': async (/** @type {import('entail').assert} */ assert, ctx) => {
    const customer = randomCustomer()
    const consumer = await randomConsumer()
    const now = new Date()
    const from = startOfYesterday(now)
    const to = startOfToday(now)

    // Create a snapshot after 'from' (in the future relative to billing period start)
    const twoDaysAfterFrom = new Date(from.getTime() + 2 * 24 * 60 * 60 * 1000)
    await ctx.spaceSnapshotStore.put({
      space: consumer.consumer,
      size: BigInt(100 * 1024 * 1024 * 1024), // 100GiB - should not be used
      recordedAt: twoDaysAfterFrom,
      provider: consumer.provider,
      insertedAt: new Date()
    })

    // Add a diff during the period
    const delta = 2 * 1024 * 1024 * 1024 // 2GiB
    await ctx.spaceDiffStore.batchPut([{
      provider: consumer.provider,
      space: consumer.consumer,
      subscription: consumer.subscription,
      cause: randomLink(),
      delta,
      receiptAt: from,
      insertedAt: new Date()
    }])

    /** @type {import('../../lib/api.js').SpaceBillingInstruction} */
    const instruction = {
      customer: customer.customer,
      account: customer.account,
      product: customer.product,
      from,
      to,
      space: consumer.consumer,
      provider: consumer.provider
    }

    const calculation = await calculatePeriodUsage(instruction, ctx)
    assert.ok(calculation.ok)

    // Should assume empty space (0) since no valid snapshot before 'from'
    // Final size is just the delta added during period
    assert.equal(calculation.ok.size, BigInt(delta))

    const expectedUsage = BigInt(delta) * BigInt(to.getTime() - from.getTime())
    assert.equal(calculation.ok.usage, expectedUsage)
  },

  // ========== P0 TESTS FOR DAILY BILLING INTEGRAL ALGORITHM ==========

  'should accumulate usage across consecutive days within same month': async (/** @type {import('entail').assert} */ assert, ctx) => {
    // P0 Test 1: Verify cumulative values build correctly day-by-day
    // Setup: Space with 100 bytes constant size, no diffs during Feb 1-3
    // Expected: Day 1 cumulative = 2400, Day 2 = 4800, Day 3 = 7200
    const customer = randomCustomer()
    const consumer = await randomConsumer()

    const size = 100n // 100 bytes constant
    const msPerHour = 60 * 60 * 1000
    const msPerDay = 24 * msPerHour

    // Simulate Feb 1, 2, 3 (same month)
    const feb1 = new Date('2026-02-01T00:00:00.000Z')
    const feb2 = new Date('2026-02-02T00:00:00.000Z')
    const feb3 = new Date('2026-02-03T00:00:00.000Z')
    const feb4 = new Date('2026-02-04T00:00:00.000Z')

    // Create initial snapshot at Feb 1 with 100 bytes (space already exists)
    await ctx.spaceSnapshotStore.put({
      space: consumer.consumer,
      size,
      recordedAt: feb1,
      provider: consumer.provider,
      insertedAt: new Date()
    })

    // No diffs during Feb 1-3, constant size

    // Day 1: Feb 1 → Feb 2
    const instruction1 = {
      customer: customer.customer,
      account: customer.account,
      product: customer.product,
      from: feb1,
      to: feb2,
      space: consumer.consumer,
      provider: consumer.provider
    }

    const calc1 = await calculatePeriodUsage(instruction1, ctx)
    assert.ok(calc1.ok)

    const dailyUsage1 = size * BigInt(msPerDay) // 100 × 24h = 2400 byte·h (using hours for readability)
    const expectedCumulative1 = dailyUsage1 // First of month, no previous
    assert.equal(calc1.ok.usage, expectedCumulative1, 'Day 1 cumulative should be 2400 byte·h')

    // Store Day 1 results
    await storeSpaceUsage(instruction1, calc1.ok, ctx)

    // Day 2: Feb 2 → Feb 3
    const instruction2 = {
      customer: customer.customer,
      account: customer.account,
      product: customer.product,
      from: feb2,
      to: feb3,
      space: consumer.consumer,
      provider: consumer.provider
    }

    const calc2 = await calculatePeriodUsage(instruction2, ctx)
    assert.ok(calc2.ok)

    const dailyUsage2 = size * BigInt(msPerDay) // 100 × 24h = 2400 byte·h
    const expectedCumulative2 = expectedCumulative1 + dailyUsage2 // 2400 + 2400 = 4800
    assert.equal(calc2.ok.usage, expectedCumulative2, 'Day 2 cumulative should be 4800 byte·h')

    // Store Day 2 results
    await storeSpaceUsage(instruction2, calc2.ok, ctx)

    // Day 3: Feb 3 → Feb 4
    const instruction3 = {
      customer: customer.customer,
      account: customer.account,
      product: customer.product,
      from: feb3,
      to: feb4,
      space: consumer.consumer,
      provider: consumer.provider
    }

    const calc3 = await calculatePeriodUsage(instruction3, ctx)
    assert.ok(calc3.ok)

    const dailyUsage3 = size * BigInt(msPerDay) // 100 × 24h = 2400 byte·h
    const expectedCumulative3 = expectedCumulative2 + dailyUsage3 // 4800 + 2400 = 7200
    assert.equal(calc3.ok.usage, expectedCumulative3, 'Day 3 cumulative should be 7200 byte·h')

    // Verify final cumulative = sum of all daily usage values
    assert.equal(calc3.ok.usage, dailyUsage1 + dailyUsage2 + dailyUsage3)
  },

  'should reset cumulative on first day of month': async (/** @type {import('entail').assert} */ assert, ctx) => {
    // P0 Test 2: Verify isFirstOfMonth resets cumulative 
    // Setup: Jan 31 with cumulative, then Feb 1 run
    // Expected: Feb 1 does NOT query previous, starts at dailyUsage only
    const customer = randomCustomer()
    const consumer = await randomConsumer()

    const size = 100n // 100 bytes constant
    const msPerDay = 24 * 60 * 60 * 1000

    const jan31 = new Date('2026-01-31T00:00:00.000Z')
    const feb1 = new Date('2026-02-01T00:00:00.000Z')
    const feb2 = new Date('2026-02-02T00:00:00.000Z')

    // Create snapshot at Jan 31 with 100 bytes
    await ctx.spaceSnapshotStore.put({
      space: consumer.consumer,
      size,
      recordedAt: jan31,
      provider: consumer.provider,
      insertedAt: new Date()
    })

    // Simulate Jan 31 usage record with large cumulative (from month of January)
    const jan31Cumulative = size * BigInt(msPerDay) * 30n // Arbitrary large cumulative from Jan
    await ctx.usageStore.put({
      customer: customer.customer,
      account: customer.account,
      product: customer.product,
      from: jan31,
      to: feb1,
      space: consumer.consumer,
      provider: consumer.provider,
      usage: jan31Cumulative,
      insertedAt: new Date()
    })

    // Store Jan 31 snapshot at Feb 1 (end of Jan 31→Feb 1 period)
    await ctx.spaceSnapshotStore.put({
      space: consumer.consumer,
      size,
      recordedAt: feb1,
      provider: consumer.provider,
      insertedAt: new Date()
    })

    // Run billing for Feb 1 → Feb 2 (first of month)
    const instruction = {
      customer: customer.customer,
      account: customer.account,
      product: customer.product,
      from: feb1,
      to: feb2,
      space: consumer.consumer,
      provider: consumer.provider
    }

    const calc = await calculatePeriodUsage(instruction, ctx)
    assert.ok(calc.ok)

    const dailyUsage = size * BigInt(msPerDay) // 100 × 24h = 2400 byte·h
    const expectedCumulative = dailyUsage // Should NOT include Jan cumulative

    assert.equal(calc.ok.usage, expectedCumulative, 'Feb 1 cumulative should start fresh, not include Jan cumulative')
    assert.ok(calc.ok.usage < jan31Cumulative, 'Feb 1 cumulative should be much smaller than Jan 31 cumulative')
  },

  'should correctly calculate usage with mid-day diff using integral algorithm': async (/** @type {import('entail').assert} */ assert, ctx) => {
    // P0 Test 3: Verify integral algorithm with mid-day diff
    // Setup: Feb 1: 100 bytes, Feb 2 12:00: +50 bytes
    // Expected: Day 2 cumulative = 5400 (NOT 10800 like buggy algorithm)
    const customer = randomCustomer()
    const consumer = await randomConsumer()

    const msPerHour = 60 * 60 * 1000
    const msPerDay = 24 * msPerHour

    const feb1 = new Date('2026-02-01T00:00:00.000Z')
    const feb2 = new Date('2026-02-02T00:00:00.000Z')
    const feb2Noon = new Date('2026-02-02T12:00:00.000Z')
    const feb3 = new Date('2026-02-03T00:00:00.000Z')

    // Create initial snapshot at Feb 1 with 100 bytes
    await ctx.spaceSnapshotStore.put({
      space: consumer.consumer,
      size: 100n,
      recordedAt: feb1,
      provider: consumer.provider,
      insertedAt: new Date()
    })

    // Add diff at Feb 2 12:00: +50 bytes
    await ctx.spaceDiffStore.batchPut([{
      provider: consumer.provider,
      space: consumer.consumer,
      subscription: consumer.subscription,
      cause: randomLink(),
      delta: 50,
      receiptAt: feb2Noon,
      insertedAt: new Date()
    }])

    // Day 1: Feb 1 → Feb 2 (no diffs, constant 100 bytes)
    const instruction1 = {
      customer: customer.customer,
      account: customer.account,
      product: customer.product,
      from: feb1,
      to: feb2,
      space: consumer.consumer,
      provider: consumer.provider
    }

    const calc1 = await calculatePeriodUsage(instruction1, ctx)
    assert.ok(calc1.ok)

    const dailyUsage1 = 100n * BigInt(msPerDay) // 100 × 24h = 2400 byte·h
    assert.equal(calc1.ok.usage, dailyUsage1)
    assert.equal(calc1.ok.size, 100n)

    // Store Day 1 results
    await storeSpaceUsage(instruction1, calc1.ok, ctx)

    // Day 2: Feb 2 → Feb 3 (diff at 12:00)
    const instruction2 = {
      customer: customer.customer,
      account: customer.account,
      product: customer.product,
      from: feb2,
      to: feb3,
      space: consumer.consumer,
      provider: consumer.provider
    }

    const calc2 = await calculatePeriodUsage(instruction2, ctx)
    assert.ok(calc2.ok)

    // Integral calculation for Day 2:
    // Interval 1 (Feb 2 00:00 → Feb 2 12:00): 100 bytes × 12h = 1200 byte·h
    // Interval 2 (Feb 2 12:00 → Feb 3 00:00): 150 bytes × 12h = 1800 byte·h
    // dailyUsage2 = 1200 + 1800 = 3000 byte·h
    const interval1 = 100n * BigInt(12 * msPerHour) // 100 × 12h = 1200
    const interval2 = 150n * BigInt(12 * msPerHour) // 150 × 12h = 1800
    const dailyUsage2 = interval1 + interval2 // 3000
    const expectedCumulative2 = dailyUsage1 + dailyUsage2 // 2400 + 3000 = 5400

    assert.equal(calc2.ok.usage, expectedCumulative2, 'Day 2 cumulative should be 5400, not 10800 (buggy formula)')
    assert.equal(calc2.ok.size, 150n)

    // Store Day 2 results
    await storeSpaceUsage(instruction2, calc2.ok, ctx)

    // Day 3: Feb 3 → Feb 4 (constant 150 bytes, no diffs)
    const feb4 = new Date('2026-02-04T00:00:00.000Z')
    const instruction3 = {
      customer: customer.customer,
      account: customer.account,
      product: customer.product,
      from: feb3,
      to: feb4,
      space: consumer.consumer,
      provider: consumer.provider
    }

    const calc3 = await calculatePeriodUsage(instruction3, ctx)
    assert.ok(calc3.ok)

    const dailyUsage3 = 150n * BigInt(msPerDay) // 150 × 24h = 3600 byte·h
    const expectedCumulative3 = expectedCumulative2 + dailyUsage3 // 5400 + 3600 = 9000

    // CRITICAL: Old buggy algorithm would give 150 × 72h = 10800 (assuming size existed since Feb 1)
    // New integral algorithm correctly gives 9000
    assert.equal(calc3.ok.usage, expectedCumulative3, 'Day 3 cumulative should be 9000, not 10800')
    assert.ok(calc3.ok.usage < 10800n * BigInt(msPerDay), 'Must not overcount usage (no size × time_since_month_start bug)')
  },

  'should handle multiple diffs in single day with correct interval calculations': async (/** @type {import('entail').assert} */ assert, ctx) => {
    // P0 Test 4: Verify integral algorithm accumulates size × interval correctly
    // Setup: Multiple diffs throughout Feb 1 (8:00, 16:00, 20:00)
    // Expected: Each interval contributes currentSize × intervalDuration
    const customer = randomCustomer()
    const consumer = await randomConsumer()

    const msPerHour = 60 * 60 * 1000

    const feb1 = new Date('2026-02-01T00:00:00.000Z')
    const feb1At08h = new Date('2026-02-01T08:00:00.000Z')
    const feb1At16h = new Date('2026-02-01T16:00:00.000Z')
    const feb1At20h = new Date('2026-02-01T20:00:00.000Z')
    const feb2 = new Date('2026-02-02T00:00:00.000Z')

    // Create initial snapshot at Feb 1 with 100 bytes
    await ctx.spaceSnapshotStore.put({
      space: consumer.consumer,
      size: 100n,
      recordedAt: feb1,
      provider: consumer.provider,
      insertedAt: new Date()
    })

    // Add multiple diffs throughout the day
    await ctx.spaceDiffStore.batchPut([
      {
        provider: consumer.provider,
        space: consumer.consumer,
        subscription: consumer.subscription,
        cause: randomLink(),
        delta: 50, // +50 bytes at 8:00, size becomes 150
        receiptAt: feb1At08h,
        insertedAt: new Date()
      },
      {
        provider: consumer.provider,
        space: consumer.consumer,
        subscription: consumer.subscription,
        cause: randomLink(),
        delta: 25, // +25 bytes at 16:00, size becomes 175
        receiptAt: feb1At16h,
        insertedAt: new Date()
      },
      {
        provider: consumer.provider,
        space: consumer.consumer,
        subscription: consumer.subscription,
        cause: randomLink(),
        delta: -75, // -75 bytes at 20:00, size becomes 100
        receiptAt: feb1At20h,
        insertedAt: new Date()
      }
    ])

    // Calculate usage for Feb 1 → Feb 2
    const instruction = {
      customer: customer.customer,
      account: customer.account,
      product: customer.product,
      from: feb1,
      to: feb2,
      space: consumer.consumer,
      provider: consumer.provider
    }

    const calc = await calculatePeriodUsage(instruction, ctx)
    assert.ok(calc.ok)

    // Manual calculation using integral algorithm:
    // Interval 1 (00:00 → 08:00): 100 bytes × 8h = 800 byte·h
    // Interval 2 (08:00 → 16:00): 150 bytes × 8h = 1200 byte·h
    // Interval 3 (16:00 → 20:00): 175 bytes × 4h = 700 byte·h
    // Interval 4 (20:00 → 24:00): 100 bytes × 4h = 400 byte·h
    // Total dailyUsage = 800 + 1200 + 700 + 400 = 3100 byte·h
    const interval1 = 100n * BigInt(8 * msPerHour)   // 800
    const interval2 = 150n * BigInt(8 * msPerHour)   // 1200
    const interval3 = 175n * BigInt(4 * msPerHour)   // 700
    const interval4 = 100n * BigInt(4 * msPerHour)   // 400
    const expectedDailyUsage = interval1 + interval2 + interval3 + interval4 // 3100 * msPerHour
    const expectedCumulative = expectedDailyUsage // First of month

    assert.equal(calc.ok.usage, expectedCumulative, 'Cumulative should be 3100 byte·h')
    assert.equal(calc.ok.size, 100n, 'Final size should be 100 bytes (after -75 deletion)')

    // Verify each interval contributed correctly (size × interval, not diff × remaining_time)
    assert.equal(expectedDailyUsage, 3100n * BigInt(msPerHour))
  }
}
