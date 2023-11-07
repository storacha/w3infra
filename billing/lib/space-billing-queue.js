import Big from 'big.js'

const GB = 1024 * 1024 * 1024

/**
 * @param {import('./api').SpaceDiffListKey & { to: Date }} params
 * @param {{ spaceDiffStore: import('./api').SpaceDiffStore }} ctx
 * @returns {AsyncIterable<import('@ucanto/interface').Result<import('./api').SpaceDiff[], import('@ucanto/interface').Failure>>}
 */
const iterateSpaceDiffs = async function * ({ provider, space, from, to }, ctx) {
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
 *
 * The usage value for the period and the space size at the end of the period
 * are returned to the caller.
 *
 * @param {import('./api').SpaceBillingInstruction} instruction
 * @param {{
 *   spaceDiffStore: import('./api').SpaceDiffStore
 *   spaceSnapshotStore: import('./api').SpaceSnapshotStore
 * }} ctx
 * @returns {Promise<import('@ucanto/interface').Result<{ usage: bigint, size: bigint }>>}
 */
export const calculatePeriodUsage = async (instruction, ctx) => {
  console.log(`Calculating usage for: ${instruction.space}`)
  console.log(`Provider: ${instruction.provider}`)
  console.log(`Customer: ${instruction.customer}`)
  console.log(`Period: ${instruction.from.toISOString()} - ${instruction.to.toISOString()}`)

  const { ok: snap, error } = await ctx.spaceSnapshotStore.get({
    space: instruction.space,
    provider: instruction.provider,
    recordedAt: instruction.from
  })
  if (error && error.name !== 'RecordNotFound') return { error }
  if (!snap) console.warn(`!!! Snapshot not found, assuming empty space !!!`)

  let size = snap?.size ?? 0n
  let usage = size * BigInt(instruction.to.getTime() - instruction.from.getTime())

  console.log(`Total size is ${size} bytes @ ${instruction.from.toISOString()}`)

  for await (const page of iterateSpaceDiffs(instruction, ctx)) {
    if (page.error) return page
    for (const diff of page.ok) {
      console.log(`${diff.delta > 0 ? '+' : ''}${diff.delta} bytes @ ${diff.receiptAt.toISOString()}`)
      size += BigInt(diff.delta)
      usage += BigInt(diff.delta) * BigInt(instruction.to.getTime() - diff.receiptAt.getTime())
    }
  }

  console.log(`Total size is ${size} bytes @ ${instruction.to.toISOString()}`)

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
 * @param {import('./api').SpaceBillingInstruction} instruction
 * @param {{ usage: bigint, size: bigint }} calculation
 * @param {{
 *   spaceSnapshotStore: import('./api').SpaceSnapshotStore
 *   usageStore: import('./api').UsageStore
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
  console.log(`Space consumed ${usage} byte/ms (~${new Big(usage.toString()).div(duration).div(GB).toFixed(2)} GiB/month)`)
  const usagePut = await ctx.usageStore.put({
    ...instruction,
    usage,
    insertedAt: new Date()
  })
  if (usagePut.error) return usagePut

  return { ok: {} }
}
