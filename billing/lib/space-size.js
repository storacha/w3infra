/**
 * Finds the most recent snapshot at or before the given target date.
 * First attempts an exact match, then falls back to listing up to 31 recent
 * snapshots (newest first) and selecting the most recent one where
 * `recordedAt <= targetDate`.
 *
 * Returns `null` when no snapshot exists before the target date (new or empty space).
 *
 * @param {{
 *   space: import('./api.js').ConsumerDID,
 *   provider: import('./api.js').ProviderDID,
 *   targetDate: Date
 * }} params
 * @param {{ spaceSnapshotStore: import('./api.js').SpaceSnapshotStore }} ctx
 * @returns {Promise<import('@ucanto/interface').Result<import('./api.js').SpaceSnapshot | null,  import('@ucanto/interface').Failure>>}
 */
export const findSnapshotAtOrBefore = async ({ space, provider, targetDate }, ctx) => {
  const { ok: snap, error } = await ctx.spaceSnapshotStore.get({
    space,
    provider,
    recordedAt: targetDate
  })

  if (error && error.name !== 'RecordNotFound') return { error }

  if (snap) {
    return { ok: snap }
  }

  console.warn(`No snapshot found at ${targetDate.toISOString()}, querying for most recent snapshot before this date...`)

  const listResult = await ctx.spaceSnapshotStore.list(
    { space, provider },
    { size: 31, scanIndexForward: false }
  )

  if (listResult.error) return listResult

  const validSnapshot = listResult.ok.results.find(
    snapshot => snapshot.recordedAt.getTime() <= targetDate.getTime()
  )

  if (validSnapshot) {
    console.log(`Found snapshot @ ${validSnapshot.recordedAt.toISOString()}: ${validSnapshot.size} bytes`)
    return { ok: validSnapshot }
  }

  console.warn(`!!! No snapshot found before ${targetDate.toISOString()}, assuming empty space !!!`)
  return { ok: null }
}

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
