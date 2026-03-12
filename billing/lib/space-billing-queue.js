import Big from 'big.js'
import {GB, startOfMonth} from './util.js'
import { findPreviousUsageBySnapshotDate } from './usage-calculations.js'
import { findSnapshotAtOrBefore, iterateSpaceDiffs } from './space-size.js'


/**
 * Calculates total usage for the given space, customer, and billing period.
 * If a size snapshot for the given `from` date is not found then the space is
 * assumed to be empty.
 * Iterates over all space diffs in the given period to calculate the total
 * usage for the period. It assumes the interval is [from, to) where `to` is exclusive.
 *
 * The usage value for the period and the space size at the end of the period
 * are returned to the caller.
 * The total "usage" is the sum of all bytes stored, multiplied by the amount of time (in ms) they were stored during the billing period.
 *
 * @param {import('./api.js').SpaceBillingInstruction} instruction
 * @param {{
 *   spaceDiffStore: import('./api.js').SpaceDiffStore
 *   spaceSnapshotStore: import('./api.js').SpaceSnapshotStore
 *   usageStore: import('./api.js').UsageStore
 * }} ctx
 * @returns {Promise<import('@ucanto/interface').Result<{ usage: bigint, size: bigint }>>}
 */
export const calculatePeriodUsage = async (instruction, ctx) => {
  console.log(`Calculating usage for: ${instruction.space}`)
  console.log(`Provider: ${instruction.provider}`)
  console.log(`Customer: ${instruction.customer}`)
  console.log(`Period: ${instruction.from.toISOString()} - ${instruction.to.toISOString()}`)

  const snapshotResult = await findSnapshotAtOrBefore({ 
    space: instruction.space, 
    provider: instruction.provider, 
    targetDate: instruction.from 
  }, ctx)
  if (snapshotResult.error) return snapshotResult
  const snapshotToUse = snapshotResult.ok
  const snapshotDate = snapshotToUse ? snapshotToUse.recordedAt : instruction.from

  // Initialize state
  let size = snapshotToUse ? snapshotToUse.size : 0n
  let previousTime = instruction.from.getTime()
  let usage = 0n

  console.log(`Starting from snapshot @ ${snapshotDate.toISOString()}: ${size} bytes`)

  // Process diffs using integral algorithm
  let totalDiffs = 0
  for await (const page of iterateSpaceDiffs({...instruction, from: snapshotDate}, ctx)) {
    if (page.error) return page
    totalDiffs += page.ok.length

    for (const diff of page.ok) {
      // Phase 1: Replay old diffs to reconstruct size at FROM
      if (diff.receiptAt.getTime() < instruction.from.getTime()) {
        console.log('receiptAt is before from')
        size += BigInt(diff.delta)
        continue
      }

      // Phase 2: Stop at period end
      if (diff.receiptAt.getTime() >= instruction.to.getTime()) break

      // Phase 3: Integral algorithm - accumulate size × interval, then update size
      const intervalMs = diff.receiptAt.getTime() - previousTime
      usage += size * BigInt(intervalMs)
      size += BigInt(diff.delta)
      previousTime = diff.receiptAt.getTime()
    }
    const date = page.ok[page.ok.length-1]?.receiptAt.toISOString()
    console.log(`Processed ${totalDiffs} diffs... day: ${date} size: ${size}`)

  }

  // Final interval from last diff (or FROM) to TO
  const finalIntervalMs = instruction.to.getTime() - previousTime
  usage += size * BigInt(finalIntervalMs)

  // Monthly accumulation

  const isSnapshotFromPreviousMonth = snapshotToUse && startOfMonth(snapshotDate) < startOfMonth(instruction.from)
  const shouldLoadPreviousUsage = snapshotToUse && !isSnapshotFromPreviousMonth

  const previousCumulative = shouldLoadPreviousUsage
    ? (await findPreviousUsageBySnapshotDate({
        customer: instruction.customer,
        space: instruction.space,
        provider: instruction.provider,
        targetDate: snapshotDate
      }, ctx)).usage
    : 0n

  const cumulativeUsage = previousCumulative + usage

  console.log(`Usage: ${usage} byte·ms`)
  console.log(`Previous cumulative: ${previousCumulative} byte·ms`)
  console.log(`New cumulative: ${cumulativeUsage} byte·ms`)
  console.log(`Final size: ${size} bytes @ ${instruction.to.toISOString()}`)

  return { ok: { size, usage: cumulativeUsage } }
}

/**
 * Stores a space usage record and space snapshot for the given space,
 * customer, and billing period.
 *
 * The space size snapshot is stored against the given `to` date of the billing
 * period. The _next_ billing period is expected to start on the `to` date of
 * the current period, so that the snapshot will be used in the next cycle.
 *
 * @param {import('./api.js').SpaceBillingInstruction} instruction
 * @param {{ usage: bigint, size: bigint }} calculation
 * @param {{
 *   spaceSnapshotStore: import('./api.js').SpaceSnapshotStore
 *   usageStore: import('./api.js').UsageStore
 * }} ctx
 * @returns {Promise<import('@ucanto/interface').Result<import('@ucanto/interface').Unit>>}
 */
export const storeSpaceUsage = async (instruction, { size, usage }, ctx) => {
  const snapPut = await ctx.spaceSnapshotStore.put({
    provider: instruction.provider,
    space: instruction.space,
    size,
    recordedAt: instruction.to,
    insertedAt: new Date()
  })
  if (snapPut.error) return snapPut

  const monthStart = startOfMonth(instruction.from)
  const duration = instruction.to.getTime() - monthStart.getTime()
  const avgGiB = new Big(usage.toString()).div(duration).div(GB).toFixed(2)

  console.log(
    `Storing usage record for ${instruction.space}:\n` +
    `  Period: ${instruction.from.toISOString()} to ${instruction.to.toISOString()}\n` +
    `  Cumulative usage from month start (${monthStart.toISOString()}): ${usage} byte·ms (~${avgGiB} GiB average)\n` +
    `  Current size at ${instruction.to.toISOString()}: ${size} bytes`
  )

  const usagePut = await ctx.usageStore.put({
    ...instruction,
    usage,
    insertedAt: new Date()
  })
  if (usagePut.error) return usagePut

  return { ok: {} }
}

/**
 * Calculates the total allocation for the specified space.  
 * Additionally, it estimates the usage for the space based on the allocation/store values.  
 * Note: This value is approximate as it doesn’t account for deleted files.
 *
 * @typedef {import('./api.js').AllocationStore} AllocationStore
 * @typedef {import('./api.js').StoreTableStore} StoreTableStore
 * @typedef {{allocationStore: AllocationStore}} AllocationStoreCtx
 * @typedef {{storeTableStore: StoreTableStore}} StoreTableStoreCtx
 * 
 * @param {"allocationStore" | "storeTableStore"} store
 * @param {import('./api.js').SpaceBillingInstruction} instruction
 * @param { AllocationStoreCtx | StoreTableStoreCtx} ctx
 * @returns {Promise<import('@ucanto/interface').Result<{ size: bigint , usage: bigint}>>}
 */
export const calculateSpaceAllocation = async (store, instruction, ctx) => {
  console.log(`Calculating total allocation for: ${instruction.space}`)
  console.log(`Provider: ${instruction.provider}`)
  console.log(`Customer: ${instruction.customer}`)
  console.log(`Period: ${instruction.from.toISOString()} - ${instruction.to.toISOString()}`)

  /** @type AllocationStore | StoreTableStore */
  const ctxStore = store === 'allocationStore' ? 
  /** @type AllocationStoreCtx */ (ctx).allocationStore :
  /** @type StoreTableStoreCtx */ (ctx).storeTableStore

  /** @type {string|undefined} */
  let cursor
  let size = 0n
  let usage = 0n
  while(true){
    const {ok: allocations, error} = await ctxStore.listBetween(
      instruction.space, 
      instruction.from, 
      instruction.to,
      {cursor, size: 100}
    )

    if (error) return { error }
  
    for (const allocation of allocations.results){
      size += allocation.size
      usage += allocation.size * BigInt(instruction.to.getTime() - allocation.insertedAt.getTime())
    }

    if (!allocations.cursor) break
    cursor = allocations.cursor
  }

  console.log(`Total allocation for ${instruction.space}: ${size} bytes`)
  const duration = instruction.to.getTime() - instruction.from.getTime()
  const usageGB = new Big(usage.toString()).div(duration).div(GB).toFixed(2)
  console.log(`Approximate space consumed ${usage} byte/ms (~${usageGB} GiB)`)
  
  return {ok: {size, usage}}
}
