import { ok } from '@ucanto/server'
import map from 'p-map'
import { MAX_BATCH_SIZE } from '../tables/client.js'

const CONCURRENCY = 10

/**
 * @param {{ blocksCarsPositionStore: import('./api.js').StoreBatchPutter<import('./api.js').Location> }} ctx
 * @param {import('./api.js').Location[]} entries
 * @returns {Promise<import('@ucanto/interface').Result<import('@ucanto/interface').Unit, import('@ucanto/interface').Failure>>}
 */
export const writeBlockIndexEntries = async (ctx, entries) => {
  const items = [...entries]
  const batches = []
  while (true) {
    const batch = items.splice(0, MAX_BATCH_SIZE)
    if (!batch.length) break
    batches.push(batch)
  }

  const results = await map(batches, batch => (
    ctx.blocksCarsPositionStore.batchPut(batch)
  ), { concurrency: CONCURRENCY })
  for (const r of results) {
    if (r.error) return r
  }

  return ok({})
}
