import Big from 'big.js'

/**
 * @param {import('./api').SpaceBillingInstruction} instruction
 * @param {{
 *   spaceDiffStore: import('./api').SpaceDiffStore
 *   spaceSnapshotStore: import('./api').SpaceSnapshotStore
 *   usageStore: import('./api').UsageStore
 * }} ctx
 * @returns {Promise<import('@ucanto/interface').Result>}
 */
export const handleSpaceBillingInstruction = async (instruction, ctx) => {
  console.log(`Processing space billing instruction for: ${instruction.space}`)
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

  /** @type {string|undefined} */
  let cursor
  while (true) {
    const spaceDiffList = await ctx.spaceDiffStore.listBetween(
      { customer: instruction.customer },
      instruction.from,
      instruction.to,
      { cursor, size: 1000 }
    )
    if (spaceDiffList.error) return spaceDiffList
    for (const diff of spaceDiffList.ok.results) {
      if (diff.provider !== instruction.provider) continue
      console.log(`${diff.change > 0 ? '+' : ''}${diff.change} bytes @ ${diff.receiptAt.toISOString()}`)
      size += BigInt(diff.change)
      usage += BigInt(diff.change) * BigInt(instruction.to.getTime() - diff.receiptAt.getTime())
    }
    if (!spaceDiffList.ok.cursor) break
    cursor = spaceDiffList.ok.cursor
  }

  console.log(`Total size is ${size} bytes @ ${instruction.to.toISOString()}`)
  const snapPut = await ctx.spaceSnapshotStore.put({
    provider: instruction.provider,
    space: instruction.space,
    size,
    recordedAt: instruction.to,
    insertedAt: new Date()
  })
  if (snapPut.error) return snapPut

  const duration = instruction.to.getTime() - instruction.from.getTime()
  console.log(`Space consumed ${usage} byte/ms (~${new Big(usage.toString()).div(duration).div(1024 * 1024 * 1024).toFixed(2)} GiB/month)`)
  return await ctx.usageStore.put({
    ...instruction,
    usage,
    insertedAt: new Date()
  })
}
