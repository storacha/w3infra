import { ok } from '@ucanto/server'
import map from 'p-map'
import { MAX_BATCH_SIZE } from '../queues/client.js'

const CONCURRENCY = 10

/**
 * @param {{ multihashesQueue: import('./api.js').QueueBatchAdder<import('multiformats').MultihashDigest> }} ctx
 * @param {{ entries: import('multiformats').MultihashDigest[] }} advert
 * @returns {Promise<import('@ucanto/interface').Result<import('@ucanto/interface').Unit, import('@ucanto/interface').Failure>>}
 */
export const publishBlockAdvertisement = async (ctx, advert) => {
  const items = [...advert.entries]
  const batches = []
  while (true) {
    const batch = items.splice(0, MAX_BATCH_SIZE)
    if (!batch.length) break
    batches.push(batch)
  }

  const results = await map(batches, batch => (
    ctx.multihashesQueue.batchAdd(batch)
  ), { concurrency: CONCURRENCY })
  for (const r of results) {
    if (r.error) return r
  }

  return ok({})
}
