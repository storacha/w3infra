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
  console.log(`processing space billing instruction for: ${instruction.customer}`)
  console.log(`period: ${instruction.from.toISOString()} - ${instruction.to.toISOString()}`)

  const { ok: snap, error } = await ctx.spaceSnapshotStore.get({
    space: instruction.space,
    provider: instruction.provider,
    recordedAt: instruction.from
  })
  if (error) return { error }

  console.log(`space ${snap.space} is ${snap.size} bytes @ ${snap.recordedAt.toISOString()}`)

  let size = snap.size
  let usage = size * (instruction.to.getTime() - instruction.from.getTime())

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
      if (diff.provider !== snap.provider) continue
      console.log(`${diff.receiptAt.toISOString()}: ${diff.change} bytes`)
      size += diff.change
      usage += diff.change * (instruction.to.getTime() - diff.receiptAt.getTime())
    }
    if (!spaceDiffList.ok.cursor) break
    cursor = spaceDiffList.ok.cursor
  }

  console.log(`space ${snap.space} is ${size} bytes @ ${instruction.to.toISOString()}`)
  const snapPut = await ctx.spaceSnapshotStore.put({
    provider: instruction.provider,
    space: instruction.space,
    size,
    recordedAt: instruction.to,
    insertedAt: new Date()
  })
  if (snapPut.error) return snapPut

  console.log(`${usage} bytes consumed over ${instruction.to.getTime() - instruction.from.getTime()} ms`)
  return await ctx.usageStore.put({
    ...instruction,
    usage,
    insertedAt: new Date()
  })
}
