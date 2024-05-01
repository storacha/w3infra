import { SQSClient, SendMessageBatchCommand } from '@aws-sdk/client-sqs'
import { DynamoDBClient, BatchWriteItemCommand } from '@aws-sdk/client-dynamodb'
import { marshall } from '@aws-sdk/util-dynamodb'
import { base58btc } from 'multiformats/bases/base58'
import retry from 'p-retry'
import { ok, error } from '@ucanto/server'

/**
 * @typedef {{
 *   digest: import('multiformats').MultihashDigest,
 *   location: URL,
 *   range: [number, number]
 * }} BlocksCarsPositionRecord
 */

/**
 * @param {{ url: string, region: string }} multihashesQueueConfig 
 * @param {{ name: string, region: string }} blocksCarsPositionConfig
 */
export const createIPNIService = (multihashesQueueConfig, blocksCarsPositionConfig) => {
  const multihashesQueue = new MultihashesQueue(multihashesQueueConfig)
  const blocksCarsPositionStore = new BlocksCarsPositionStore(blocksCarsPositionConfig)
  return useIPNIService(multihashesQueue, blocksCarsPositionStore)
}

/**
 * @param {MultihashesQueue} multihashesQueue
 * @param {BlocksCarsPositionStore} blocksCarsPositionStore
 */
const useIPNIService = (multihashesQueue, blocksCarsPositionStore) => ({
  /** @param {import('@web3-storage/upload-api').ShardedDAGIndex} index */
  async publish (index) {
    const digests = [...index.shards.keys()]
    /** @type {BlocksCarsPositionRecord[]} */
    const records = []
    for (const shard of index.shards.values()) {
      for (const [digest, range] of shard.entries()) {
        records.push({ digest, location: new URL(''), range })
        digests.push(digest)
      }
    }
    await Promise.all([
      multihashesQueue.addAll(digests),
      blocksCarsPositionStore.putAll(records)
    ])
  }
})

class MultihashesQueue {
  #client
  #url

  /**
   * @param {object} config
   * @param {string} config.region
   * @param {string} config.url
   */
  constructor (config) {
    this.#client = new SQSClient(config)
    this.#url = config.url
  }

  /** @param {import('multiformats').MultihashDigest[]} digests */
  async addAll (digests) {
    try {
      const items = [...digests]
      while (true) {
        const batch = items.splice(0, 10)
        if (!batch.length) break

        const dedupedBatch = new Set(batch.map(s => base58btc.encode(s.bytes)))
        let entries = [...dedupedBatch.values()].map(s => ({ Id: s, MessageBody: s }))

        await retry(async () => {
          const cmd = new SendMessageBatchCommand({
            QueueUrl: this.#url,
            Entries: entries
          })
          const res = await this.#client.send(cmd)
          const failures = res.Failed
          if (failures?.length) {
            failures.forEach(f => console.warn(f))
            entries = entries.filter(e => failures.some(f => f.Id === e.Id))
            throw new Error('failures in response')
          }
        })
      }
    } catch (/** @type {any} */ err) {
      return error(err)
    }
  }
}

class BlocksCarsPositionStore {
  #client
  #name

  /**
   * @param {object} config
   * @param {string} config.region
   * @param {string} config.name
   */
  constructor (config) {
    this.#client = new DynamoDBClient(config)
    this.#name = config.name
  }

  /** @param {BlocksCarsPositionRecord[]} records */
  async putAll (records) {
    const items = [...records]
    while (true) {
      const batch = items.splice(0, 25)
      if (!batch.length) break

      /** @type {Record<string, import('@aws-sdk/client-dynamodb').WriteRequest[]>} */
      let requestItems = {
        [this.#name]: batch.map(r => ({
          PutRequest: {
            Item: marshall({
              blockmultihash: base58btc.encode(r.digest.bytes),
              carpath: r.location.toString(),
              offset: r.range[0],
              length: r.range[1]
            })
          }
        }))
      }
      await retry(async () => {
        const cmd = new BatchWriteItemCommand({ RequestItems: requestItems })
        const res = await this.#client.send(cmd)
        if (res.UnprocessedItems && Object.keys(res.UnprocessedItems).length) {
          requestItems = res.UnprocessedItems
          throw new Error('unprocessed items')
        }
      })
    }
  }
}
