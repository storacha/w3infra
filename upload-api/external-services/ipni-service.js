import { SendMessageCommand } from '@aws-sdk/client-sqs'
import * as dagJSON from '@ipld/dag-json'
import retry from 'p-retry'
import map from 'p-map'
import { ok, error } from '@ucanto/server'
import { getSQSClient } from '../../lib/aws/sqs.js'

/**
 * @typedef {Map<import('multiformats').MultihashDigest, [offset: number, length: number]>} Slices
 */

const CONCURRENCY = 10

/**
 * @param {{ url: URL, region: string }} blockAdvertisementPublisherQueueConfig 
 */
export const createIPNIService = (blockAdvertisementPublisherQueueConfig) => {
  const blockAdvertPublisherQueue = new BlockAdvertisementPublisherQueue({
    client: getSQSClient(blockAdvertisementPublisherQueueConfig),
    url: blockAdvertisementPublisherQueueConfig.url
  })
  return useIPNIService(blockAdvertPublisherQueue)
}

/**
 * @param {BlockAdvertisementPublisherQueue} blockAdvertPublisherQueue
 * @returns {import('@web3-storage/upload-api').IPNIService}
 */
export const useIPNIService = (blockAdvertPublisherQueue) => ({
  /** @param {import('@web3-storage/upload-api').ShardedDAGIndex} index */
  async publish (index) {
    /** @type {import('multiformats').MultihashDigest[]} */
    const entries = []

    for (const [, slices] of index.shards.entries()) {
      entries.push(...slices.keys())
    }

    const addRes = await blockAdvertPublisherQueue.add({ entries })
    if (addRes.error) return addRes

    return ok({})
  }
})

// Max SendMessage size is 262,144 bytes
// ```js
// new TextEncoder().encode(JSON.stringify(Array(3000).fill('{"/":{"bytes":"EiAAFf1QaZ0itsQw5NFRHmlfXiCHIsRpaFKFVqTdzPTBMg"}}'))).length
// ```
// = 219,001
const MAX_BLOCK_DIGESTS = 3000

/** Queues adverts for IPNI publishing. */
export class BlockAdvertisementPublisherQueue {
  #client
  #url

  /**
   * @param {object} config
   * @param {import('@aws-sdk/client-sqs').SQSClient} config.client
   * @param {URL} config.url
   */
  constructor (config) {
    this.#client = config.client
    this.#url = config.url
  }

  /**
   * @param {{ entries: import('multiformats').MultihashDigest[] }} advert
   * @returns {Promise<import('@ucanto/interface').Result<import('@ucanto/interface').Unit, import('@ucanto/interface').Failure>>}
   */
  async add (advert) {
    try {
      const items = advert.entries.map(d => d.bytes)
      const batches = []
      while (true) {
        const batch = items.splice(0, MAX_BLOCK_DIGESTS)
        if (!batch.length) break
        batches.push(batch)
      }

      await map(batches, (batch) => (
        retry(() => {
          /** @type {import('../../indexer/types.js').PublishAdvertisementMessage} */
          const message = { entries: batch }
          const cmd = new SendMessageCommand({
            QueueUrl: this.#url.toString(),
            MessageBody: dagJSON.stringify(message)
          })
          return this.#client.send(cmd)
        })
      ), { concurrency: CONCURRENCY })

      return ok({})
    } catch (/** @type {any} */ err) {
      console.error('failed to queue entries for IPNI advertisement publisher', err)
      return error({
        name: 'BlockAdvertPublisherQueueError',
        message: `failed to queue entries for IPNI advertisement publisher: ${err.message}`
      })
    }
  }
}
