import { SendMessageCommand } from '@aws-sdk/client-sqs'
import * as dagJSON from '@ipld/dag-json'
import retry from 'p-retry'
import map from 'p-map'
import Queue from 'p-queue'
import { ok, error } from '@ucanto/server'
import { getSQSClient } from '../../lib/aws/sqs.js'

/**
 * @typedef {Map<import('multiformats').MultihashDigest, [offset: number, length: number]>} Slices
 */

const CONCURRENCY = 10

/** @param {import('@storacha/upload-api').ProviderDID} s */
export const isW3sProvider = (s) => s.endsWith('web3.storage')

/**
 * @param {{ url: URL, region: string }} blockAdvertisementPublisherQueueConfig
 * @param {{ url: URL, region: string }} blockIndexWriterQueueConfig
 * @param {import('@web3-storage/upload-api').BlobsStorage} blobsStorage
 */
export const createIPNIService = (blockAdvertisementPublisherQueueConfig, blockIndexWriterQueueConfig, blobsStorage) => {
  const blockAdvertPublisherQueue = new BlockAdvertisementPublisherQueue({
    client: getSQSClient(blockAdvertisementPublisherQueueConfig),
    url: blockAdvertisementPublisherQueueConfig.url
  })
  const blockIndexWriterQueue = new BlockIndexWriterQueue({
    client: getSQSClient(blockIndexWriterQueueConfig),
    url: blockIndexWriterQueueConfig.url
  })
  return useIPNIService(blockAdvertPublisherQueue, blockIndexWriterQueue, blobsStorage)
}

/**
 * @param {BlockAdvertisementPublisherQueue} blockAdvertPublisherQueue
 * @param {BlockIndexWriterQueue} blockIndexWriterQueue
 * @param {import('@web3-storage/upload-api').BlobsStorage} blobsStorage
 * @returns {import('@storacha/upload-api').IPNIService}
 */
export const useIPNIService = (blockAdvertPublisherQueue, blockIndexWriterQueue, blobsStorage) => ({
  /** @type {import('@storacha/upload-api').IPNIService['publish']} */
  async publish (space, providers, index) {
    console.log('publish to IPNI', space, providers, index)
    try {
      /** @type {import('multiformats').MultihashDigest[]} */
      const entries = []

      for (const [, slices] of index.shards.entries()) {
        entries.push(...slices.keys())
      }

      const addRes = await blockAdvertPublisherQueue.add({ entries })
      if (addRes.error) return addRes
      console.log('published to blockAdvertPublisherQueue')

      // spaces with legacy providers need to be added to the legacy E-IPFS block
      // index writer queue.
      if (providers.some(isW3sProvider)) {
        /** @type {Array<[location: URL, slices: Slices]>} */
        const records = []
        for (const [shard, slices] of index.shards.entries()) {
          const createUrlRes = await blobsStorage.createDownloadUrl(shard)
          if (!createUrlRes.ok) return createUrlRes
          const location = new URL(createUrlRes.ok)
          console.log('location', location.toString())
          records.push([location, slices])
          entries.push(...slices.keys())
        }
        const queueRes = await blockIndexWriterQueue.add(records)
        if (queueRes.error) return queueRes
        console.log('published to blockIndexWriterQueue')
      }
    } catch (/** @type {any} */err) {
      console.log(err)
    }

    console.log('successfully published to IPNI')
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

// Max SendMessage size is 262,144 bytes
// ```js
// const { base58btc } = await import('multiformats/bases/base58')
// const Digest = await import('multiformats/hashes/digest')
// const dagJSON = await import('@ipld/dag-json')
// new TextEncoder().encode(
//   dagJSON.stringify(
//     [
//       'https://xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx.w3s.link/zQmNLfzmTMp1CBZAX8atkYWrefR6L3BTsSeghvmsQDMfaHt/zQmNLfzmTMp1CBZAX8atkYWrefR6L3BTsSeghvmsQDMfaHt.blob',
//       Array(2000).fill(
//         [
//           Digest.decode(base58btc.decode('zQmNLfzmTMp1CBZAX8atkYWrefR6L3BTsSeghvmsQDMfaHt')).bytes,
//           [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER]
//         ]
//       )
//     ]
//   )
// ).length
// ```
// = 206,156
const MAX_INDEX_ENTRIES = 2000

/** Queues block index records for writing to DynamoDB. */
export class BlockIndexWriterQueue {
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
   * @param {Array<[location: URL, slices: Slices]>} records
   * @returns {Promise<import('@ucanto/interface').Result<import('@ucanto/interface').Unit, import('@ucanto/interface').Failure>>}
   */
  async add (records) {
    try {
      const queue = new Queue({ concurrency: CONCURRENCY })
      const requests = []

      for (const [location, slices] of records) {
        /** @type {Array<[Uint8Array, [number, number]]>} */
        const items = [...slices.entries()].map(s => [s[0].bytes, s[1]])
        while (true) {
          const batch = items.splice(0, MAX_INDEX_ENTRIES)
          if (!batch.length) break
          requests.push(() => (
            retry(() => {
              /** @type {import('../../indexer/types.js').BlockIndexQueueMessage} */
              const message = [location.toString(), batch]
              const cmd = new SendMessageCommand({
                QueueUrl: this.#url.toString(),
                MessageBody: dagJSON.stringify(message)
              })
              return this.#client.send(cmd)
            })
          ))
        }
      }

      await queue.addAll(requests)
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
