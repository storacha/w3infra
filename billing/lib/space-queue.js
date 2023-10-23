/**
 * @param {import('./api').SpaceBillingInstruction} instruction 
 * @param {{
 *   spaceDiffStore: import('./api').SpaceDiffStore
 *   spaceSnapshotStore: import('./api').SpaceSnapshotStore
 *   usageStore: import('./api').UsageStore
 * }} stores
 * @returns {Promise<import('@ucanto/interface').Result>}
 */
export const handleSpaceBillingInstruction = async (instruction, {
  spaceDiffStore,
  spaceSnapshotStore,
  usageStore
}) => {
  console.log(`processing space billing instruction for: ${instruction.customer}`)
  console.log(`period: ${instruction.from.toISOString()} - ${instruction.to.toISOString()}`)

  const { ok: snap, error } = await spaceSnapshotStore.get({
    space: instruction.space,
    provider: instruction.provider,
    recordedAt: instruction.from
  })
  if (error) return { error }

  console.log(`space ${snap.space} is ${snap.size} bytes @ ${snap.recordedAt.toISOString()}`)

  /** @type {import('./api').SpaceDiff[]} */
  const diffs = []

  let cursor
  while (true) {
    const { ok: listing, error: listErr } = await spaceDiffStore.listBetween(
      { customer: instruction.customer },
      instruction.from,
      instruction.to,
      { cursor, size: 1000 }
    )
    if (listErr) return { error: listErr }
    for (const diff of listing.results) {
      if (diff.provider !== snap.provider) continue
      diffs.push(diff)
    }
    if (!listing.cursor) break
    cursor = listing.cursor
  }

  console.log(`${diffs.length} space updates`)

  return { ok: {} }
}
