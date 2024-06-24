import { BatchWriteItemCommand } from '@aws-sdk/client-dynamodb'
import { marshall } from '@aws-sdk/util-dynamodb'
import { ok, error } from '@ucanto/server'
import { base58btc } from 'multiformats/bases/base58'
import retry from 'p-retry'
import map from 'p-map'

/** The maximum size a Dynamo batch can be. */
const MAX_TABLE_BATCH_SIZE = 25
const CONCURRENCY = 10

/**
 * @param {{ tableName: string, client: import('@aws-sdk/client-dynamodb').DynamoDBClient }} ctx
 * @param {Array<{
 *   digest: import('multiformats').MultihashDigest
 *   location: URL
 *   range: [number, number]
 * }>} records
 * @returns {Promise<import('@ucanto/interface').Result<import('@ucanto/interface').Unit, import('@ucanto/interface').Failure>>}
 */
export const writeBlockIndexEntries = async (ctx, records) => {
  try {
    const items = [...records]
    const batches = []
    while (true) {
      const batch = items.splice(0, MAX_TABLE_BATCH_SIZE)
      if (!batch.length) break
      batches.push(batch)
    }

    await map(batches, async batch => {
      /** @type {Record<string, import('@aws-sdk/client-dynamodb').WriteRequest[]>} */
      let requestItems = {
        [ctx.tableName]: batch.map(r => ({
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
        const res = await ctx.client.send(cmd)
        if (res.UnprocessedItems && Object.keys(res.UnprocessedItems).length) {
          requestItems = res.UnprocessedItems
          throw new Error('unprocessed items')
        }
      })
    }, { concurrency: CONCURRENCY })
    return ok({})
  } catch (/** @type {any} */ err) {
    console.error('failed to put records to block index', err)
    return error({
      name: 'WriteBlockIndexEntriesError',
      message: `failed to put records to block index: ${err.message}`
    })
  }
}
