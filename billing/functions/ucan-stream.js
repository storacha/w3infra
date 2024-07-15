import * as Sentry from '@sentry/serverless'
import { toString, fromString } from 'uint8arrays'
import * as Link from 'multiformats/link'
import { LRUCache } from 'lru-cache'
import { createSpaceDiffStore } from '../tables/space-diff.js'
import { createConsumerStore } from '../tables/consumer.js'
import { expect, mustGetEnv } from './lib.js'
import { findSpaceUsageDeltas, storeSpaceUsageDelta } from '../lib/ucan-stream.js'

Sentry.AWSLambda.init({
  environment: process.env.SST_STAGE,
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 1.0
})

/**
 * @typedef {{
 *   spaceDiffTable?: string
 *   consumerTable?: string
 *   region?: 'us-west-2'|'us-east-2'
 * }} CustomHandlerContext
 */

export const handler = Sentry.AWSLambda.wrapHandler(
  /**
   * @param {import('aws-lambda').KinesisStreamEvent} event
   * @param {import('aws-lambda').Context} context
   */
  async (event, context) => {
    /** @type {CustomHandlerContext|undefined} */
    const customContext = context?.clientContext?.Custom
    const spaceDiffTable = customContext?.spaceDiffTable ?? mustGetEnv('SPACE_DIFF_TABLE_NAME')
    const consumerTable = customContext?.consumerTable ?? mustGetEnv('CONSUMER_TABLE_NAME')
    const region = customContext?.region ?? mustGetEnv('AWS_REGION')
  
    const messages = parseUcanStreamEvent(event)
    if (!messages || messages.length > 1) {
      throw new Error(`invalid batch size, expected: 1, actual: ${messages.length}`)
    }

    const deltas = findSpaceUsageDeltas(messages)
    if (!deltas.length) {
      console.log("No messages found that contain space usage deltas", "capabilities", messages[0].value.att.map((att) => att.can), "resources", messages[0].value.att.map((att) => att.with) )
      return
    }
    console.log("Storing space usage delta", deltas[0])
    
    const consumerStore = createConsumerStore({ region }, { tableName: consumerTable })
    const spaceDiffStore = createSpaceDiffStore({ region }, { tableName: spaceDiffTable })
    const ctx = { spaceDiffStore, consumerStore: withConsumerListCache(consumerStore) }
    expect(
      await storeSpaceUsageDelta(deltas[0], ctx),
      `storing space usage delta for: ${deltas[0].resource}, cause: ${deltas[0].cause}`
    )
  }
)

/**
 * @param {import('aws-lambda').KinesisStreamEvent} event
 * @returns {import('../lib/api').UcanStreamMessage[]}
 */
const parseUcanStreamEvent = event => {
  const batch = event.Records.map(r => fromString(r.kinesis.data, 'base64'))
  return batch.map(b => {
    const json = JSON.parse(toString(b, 'utf8'))
    if (json.type === 'receipt') {
      return {
        type: 'receipt',
        value: { ...json.value, cid: Link.parse(json.value.cid) },
        carCid: Link.parse(json.carCid),
        invocationCid: Link.parse(json.invocationCid),
        out: json.out,
        ts: new Date(json.ts)
      }
    } else if (json.type === 'workflow') {
      return {
        type: 'workflow',
        value: { ...json.value, cid: Link.parse(json.value.cid) },
        carCid: Link.parse(json.carCid),
        ts: new Date(json.ts)
      }
    } else {
      throw new Error(`unknown message type: ${json.type}`)
    }
  })
}

/**
 * This means that if a subscription for a space changes, there's a 5 minute
 * (max) period where writes may be attributed to the previous subscription.
 *
 * This happens very infrequently, and DynamoDB is _already_ eventually
 * consistent on read so we're just pushing out this delay a little more to
 * be able to process data for spaces with frequent writes a lot quicker.
 */
const CONSUMER_LIST_CACHE_TTL = 1000 * 60 * 5
const CONSUMER_LIST_CACHE_MAX = 10_000

/**
 * @param {import('../lib/api').ConsumerStore} consumerStore
 * @returns {import('../lib/api').ConsumerStore}
 */
const withConsumerListCache = (consumerStore) => {
  /** @type {LRUCache<string, Awaited<ReturnType<import('../lib/api').ConsumerStore['list']>>>} */
  const cache = new LRUCache({
    max: CONSUMER_LIST_CACHE_MAX,
    ttl: CONSUMER_LIST_CACHE_TTL
  })
  return {
    ...consumerStore,
    async list (key, options) {
      const cacheKeySuffix = options ? `?cursor=${options.cursor}&size=${options.size}` : ''
      const cacheKey = `${key.consumer}${cacheKeySuffix}`
      const cached = cache.get(cacheKey)
      if (cached) return cached
      const res = await consumerStore.list(key, options)
      if (res.ok) cache.set(key.consumer, res)
      return res
    }
  }
}
