import { SendMessageBatchCommand } from '@aws-sdk/client-sqs'
import { ok, error } from '@ucanto/server'
import { base58btc } from 'multiformats/bases/base58'
import retry from 'p-retry'
import map from 'p-map'

/** The maximum size an SQS batch can be. */
const MAX_QUEUE_BATCH_SIZE = 10
const CONCURRENCY = 10

/**
 * @param {{ url: URL, client: import('@aws-sdk/client-sqs').SQSClient }} ctx
 * @param {{ entries: import('multiformats').MultihashDigest[] }} advert
 * @returns {Promise<import('@ucanto/interface').Result<import('@ucanto/interface').Unit, import('@ucanto/interface').Failure>>}
 */
export const publishBlockAdvertisement = async (ctx, advert) => {
  try {
    // multihashes queue requires base58btc encoded string multihash
    const items = advert.entries.map(d => base58btc.encode(d.bytes))
    const batches = []
    while (true) {
      const batch = items.splice(0, MAX_QUEUE_BATCH_SIZE)
      if (!batch.length) break
      batches.push(batch)
    }

    await map(batches, async batch => {
      let entries = batch.map(s => ({ Id: s, MessageBody: s }))
      await retry(async () => {
        const cmd = new SendMessageBatchCommand({
          QueueUrl: ctx.url.toString(),
          Entries: entries
        })
        const res = await ctx.client.send(cmd)
        const failures = res.Failed
        if (failures?.length) {
          failures.forEach(f => console.warn(f))
          entries = entries.filter(e => failures.some(f => f.Id === e.Id))
          throw new Error('failures in response')
        }
      })
    }, { concurrency: CONCURRENCY })

    return ok({})
  } catch (/** @type {any} */ err) {
    console.error('failed to add entries to IPNI advertisement queue', err)
    return error({
      name: 'PublishBlockAdvertError',
      message: `failed to publish IPNI entries: ${err.message}`
    })
  }
}
