import Big from 'big.js'
import {GB} from './util.js'

/**
 * @param {import('./api.js').SpaceDiffListKey & { to: Date }} params
 * @param {{ spaceDiffStore: import('./api.js').SpaceDiffStore }} ctx
 * @returns {AsyncIterable<import('@ucanto/interface').Result<import('./api.js').SpaceDiff[], import('@ucanto/interface').Failure>>}
 */
export const iterateSpaceDiffs = async function * ({ provider, space, from, to }, ctx) {
  /** @type {string|undefined} */
  let cursor
  let done = false
  while (true) {
    const spaceDiffList = await ctx.spaceDiffStore.list(
      { provider, space, from },
      { cursor, size: 1000 }
    )
    if (spaceDiffList.error) return spaceDiffList

    const diffs = []
    for (const diff of spaceDiffList.ok.results) {
      // NOTE: the interval is [from, to) where `to` is exclusive
      if (diff.receiptAt.getTime() >= to.getTime()) {
        done = true
        break
      }
      diffs.push(diff)
    }
    yield { ok: diffs }
    if (done || !spaceDiffList.ok.cursor) break
    cursor = spaceDiffList.ok.cursor
  }
}

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
 * }} ctx
 * @returns {Promise<import('@ucanto/interface').Result<{ usage: bigint, size: bigint }>>}
 */
export const calculatePeriodUsage = async (instruction, ctx) => {
  console.log(`Calculating usage for: ${instruction.space}`)
  console.log(`Provider: ${instruction.provider}`)
  console.log(`Customer: ${instruction.customer}`)
  console.log(`Period: ${instruction.from.toISOString()} - ${instruction.to.toISOString()}`)

  // Try to get snapshot at exact 'from' date first
  const { ok: snap, error } = await ctx.spaceSnapshotStore.get({
    space: instruction.space,
    provider: instruction.provider,
    recordedAt: instruction.from
  })
  if (error && error.name !== 'RecordNotFound') return { error }

  let snapshotToUse = snap
  let snapshotDate = instruction.from

  // If no snapshot at exact 'from' date, list snapshots in descending order (newest first)
  // and check if the most recent one is before 'from'.
  if (!snap) {
    console.warn(`No snapshot found at ${instruction.from.toISOString()}, querying for most recent snapshot before this date...`)

    const listResult = await ctx.spaceSnapshotStore.list({
      space: instruction.space,
      provider: instruction.provider
    }, { size: 1, scanIndexForward: false }) // get newest snapshot

    if (listResult.error) return listResult

    // Check if the newest snapshot is at or before 'from'
    const newestSnapshot = listResult.ok.results[0]
    if (newestSnapshot && newestSnapshot.recordedAt.getTime() <= instruction.from.getTime()) {
      snapshotToUse = newestSnapshot
      snapshotDate = newestSnapshot.recordedAt
      console.log(`Found snapshot @ ${snapshotDate.toISOString()}: ${newestSnapshot.size} bytes`)
    } else {
      console.warn(`!!! No snapshot found before ${instruction.from.toISOString()}, assuming empty space !!!`)
    }
  }

  let size = snapshotToUse ? snapshotToUse.size : 0n
  let usage = size * BigInt(instruction.to.getTime() - snapshotDate.getTime()) // initial usage from snapshot

  console.log(`Starting calculation from ${snapshotDate.toISOString()}: ${size} bytes for ${instruction.space}`)

  let totalDiffs = 0
  for await (const page of iterateSpaceDiffs({...instruction, from: snapshotDate}, ctx)) {
    if (page.error) return page
    totalDiffs += page.ok.length
    for (const diff of page.ok) {
      size += BigInt(diff.delta)
      usage += BigInt(diff.delta) * BigInt(instruction.to.getTime() - diff.receiptAt.getTime())
    }
    console.log(`Total ${totalDiffs} diffs processed for space: ${instruction.space}...`)
  }

  console.log(`Final total size of ${instruction.space} is ${size} bytes and usage ${usage} byte/ms @ ${instruction.to.toISOString()}`)

  return { ok: { size, usage } }
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

  const duration = instruction.to.getTime() - instruction.from.getTime()
  console.log(`Total accumulated storage usage for ${instruction.space} is ${usage} byte/ms (~${new Big(usage.toString()).div(duration).div(GB).toFixed(2)} GiB)`)
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
