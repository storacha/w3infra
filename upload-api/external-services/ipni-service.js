import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs'
import * as dagJSON from '@ipld/dag-json'
import retry from 'p-retry'
import map from 'p-map'
import { ok, error } from '@ucanto/server'

/**
 * @typedef {{
 *   digest: import('multiformats').MultihashDigest,
 *   location: URL,
 *   range: [number, number]
 * }} BlocksCarsPositionRecord
 */

const CONCURRENCY = 10

/**
 * @param {{ url: URL, region: string }} blockAdvertisementPublisherQueueConfig 
 * @param {{ url: URL, region: string }} blockIndexWriterQueueConfig
 * @param {import('@web3-storage/upload-api').BlobsStorage} blobsStorage
 */
export const createIPNIService = (blockAdvertisementPublisherQueueConfig, blockIndexWriterQueueConfig, blobsStorage) => {
  const blockAdvertPublisherQueue = new BlockAdvertisementPublisherQueue({
    client: new SQSClient(blockAdvertisementPublisherQueueConfig),
    url: blockAdvertisementPublisherQueueConfig.url
  })
  const blockIndexWriterQueue = new BlockIndexWriterQueue({
    client: new SQSClient(blockIndexWriterQueueConfig),
    url: blockIndexWriterQueueConfig.url
  })
  return useIPNIService(blockAdvertPublisherQueue, blockIndexWriterQueue, blobsStorage)
}

/**
 * @param {BlockAdvertisementPublisherQueue} blockAdvertPublisherQueue
 * @param {BlockIndexWriterQueue} blockIndexWriterQueue
 * @param {import('@web3-storage/upload-api').BlobsStorage} blobsStorage
 * @returns {import('@web3-storage/upload-api').IPNIService}
 */
export const useIPNIService = (blockAdvertPublisherQueue, blockIndexWriterQueue, blobsStorage) => ({
  /** @param {import('@web3-storage/upload-api').ShardedDAGIndex} index */
  async publish (index) {
    /** @type {import('multiformats').MultihashDigest[]} */
    const items = []
    /** @type {BlocksCarsPositionRecord[]} */
    const records = []
    for (const [shard, slices] of index.shards.entries()) {
      for (const [digest, range] of slices.entries()) {
        items.push(digest)

        const createUrlRes = await blobsStorage.createDownloadUrl(shard)
        if (!createUrlRes.ok) return createUrlRes

        const location = new URL(createUrlRes.ok)
        records.push({ digest, location, range })
      }
    }

    const addRes = await blockAdvertPublisherQueue.add(items)
    if (addRes.error) return addRes

    const queueRes = await blockIndexWriterQueue.add(records)
    if (queueRes.error) return queueRes

    return ok({})
  }
})

// Max SendMessage size is 256KB
// new TextEncoder().encode(JSON.stringify(Array(3000).fill('{"/":{"bytes":"EiAAFf1QaZ0itsQw5NFRHmlfXiCHIsRpaFKFVqTdzPTBMg"}}'))).length = 219001
const MAX_BLOCK_DIGESTS = 3000

export class BlockAdvertisementPublisherQueue {
  #client
  #url

  /**
   * @param {object} config
   * @param {SQSClient} config.client
   * @param {URL} config.url
   */
  constructor (config) {
    this.#client = config.client
    this.#url = config.url
  }

  /**
   * @param {import('multiformats').MultihashDigest[]} digests
   * @returns {Promise<import('@ucanto/interface').Result<import('@ucanto/interface').Unit, import('@ucanto/interface').Failure>>}
   */
  async add (digests) {
    try {
      // stringify and dedupe
      const items = [...new Set(digests.map(d => dagJSON.stringify(d.bytes))).values()]
      let batches = []
      while (true) {
        const batch = items.splice(0, MAX_BLOCK_DIGESTS)
        if (!batch.length) break
        batches.push(batch)
      }

      await map(batches, async (batch) => {
        await retry(async () => {
          const cmd = new SendMessageCommand({
            QueueUrl: this.#url.toString(),
            MessageBody: JSON.stringify(batch)
          })
          await this.#client.send(cmd)
        })
      }, { concurrency: CONCURRENCY })

      return ok({})
    } catch (/** @type {any} */ err) {
      console.error('failed to queue entries for IPNI advertisement publisher', err)
      return error({
        name: 'IPNIBlockAdvertPublisherQueueEntriesError',
        message: `failed to queue entries for IPNI advertisement publisher: ${err.message}`
      })
    }
  }
}

const MAX_INDEX_ENTRIES = 500

export class BlockIndexWriterQueue {
  #client
  #url

  /**
   * @param {object} config
   * @param {SQSClient} config.client
   * @param {URL} config.url
   */
  constructor (config) {
    this.#client = config.client
    this.#url = config.url
  }

  /**
   * @param {BlocksCarsPositionRecord[]} records
   * @returns {Promise<import('@ucanto/interface').Result<import('@ucanto/interface').Unit, import('@ucanto/interface').Failure>>}
   */
  async add (records) {
    try {
      const items = records.map(r => ({
        digest: r.digest.bytes,
        location: r.location.toString(),
        range: r.range
      }))
      let batches = []
      while (true) {
        const batch = items.splice(0, MAX_INDEX_ENTRIES)
        if (!batch.length) break
        batches.push(batch)
      }

      await map(batches, async (batch) => {
        await retry(async () => {
          const cmd = new SendMessageCommand({
            QueueUrl: this.#url.toString(),
            MessageBody: dagJSON.stringify(batch)
          })
          await this.#client.send(cmd)
        })
      }, { concurrency: CONCURRENCY })

      return ok({})
    } catch (/** @type {any} */ err) {
      console.error('failed to queue records for block index', err)
      return error({
        name: 'BlockIndexQueueRecordsError',
        message: `failed to queue records for block index: ${err.message}`
      })
    }
  }
}
