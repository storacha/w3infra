import * as Sentry from '@sentry/serverless'
import { toString, fromString } from 'uint8arrays'
import * as StoreCaps from '@web3-storage/capabilities/store'
import * as Link from 'multiformats/link'
import { createSpaceSizeDiffStore } from '../tables/space-size-diff.js'
import { createSubscriptionStore } from '../tables/subscription.js'
import { createConsumerStore } from '../tables/consumer.js'
import { notNully } from './lib.js'

Sentry.AWSLambda.init({
  environment: process.env.SST_STAGE,
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 1.0
})

/**
 * @typedef {{
 *   spaceSizeDiffTable?: string
 *   subscriptionTable?: string
 *   consumerTable?: string
 *   dbEndpoint?: URL
 *   region?: 'us-west-2'|'us-east-2'
 * }} CustomHandlerContext
 */

/**
 * @param {import('aws-lambda').KinesisStreamEvent} event
 * @param {import('aws-lambda').Context} context
 */
export const _handler = async (event, context) => {
  /** @type {CustomHandlerContext|undefined} */
  const customContext = context?.clientContext?.Custom
  const spaceSizeDiffTable = customContext?.spaceSizeDiffTable ?? notNully(process.env, 'SPACE_SIZE_DIFF_TABLE_NAME')
  const subscriptionTable = customContext?.subscriptionTable ?? notNully(process.env, 'SUBSCRIPTION_TABLE_NAME')
  const consumerTable = customContext?.consumerTable ?? notNully(process.env, 'CONSUMER_TABLE_NAME')
  const dbEndpoint = new URL(customContext?.dbEndpoint ?? notNully(process.env, 'DYNAMO_DB_ENDPOINT'))
  const region = customContext?.region ?? notNully(process.env, 'AWS_REGION')

  const messages = parseUcanStreamEvent(event)
  const storeOptions = { endpoint: dbEndpoint }
  const stores = {
    spaceSizeDiffStore: createSpaceSizeDiffStore(region, spaceSizeDiffTable, storeOptions),
    subscriptionStore: createSubscriptionStore(region, subscriptionTable, storeOptions),
    consumerStore: createConsumerStore(region, consumerTable, storeOptions)
  }
  const results = await Promise.all(messages.map(m => putSpaceSizeDiff(m, stores)))
  for (const r of results) if (r.error) throw r.error
}

/**
 * @param {import('../types').UcanStreamMessage} message
 * @param {{
 *   spaceSizeDiffStore: import('../types').SpaceSizeDiffStore
 *   subscriptionStore: import('../types').SubscriptionStore
 *   consumerStore: import('../types').ConsumerStore
 * }} stores
 * @returns {Promise<import('@ucanto/interface').Result>}
 */
export const putSpaceSizeDiff = async (message, { spaceSizeDiffStore, subscriptionStore, consumerStore }) => {
  if (!isReceipt(message)) return { ok: {} }

  /** @type {number|undefined} */
  let size
  if (isReceiptForCapability(message, StoreCaps.add) && isStoreAddSuccess(message.out)) {
    size = message.value.att[0].nb?.size
  } else if (isReceiptForCapability(message, StoreCaps.remove) && isStoreRemoveSuccess(message.out)) {
    size = -message.out.ok.size
  } else {
    return { ok: {} }
  }

  if (size == null) {
    return { error: new Error(`missing size: ${message.carCid}`) }
  }

  const space = /** @type {import('@ucanto/interface').DID} */ (message.value.att[0].with)
  const { ok: consumers, error } = await consumerStore.getBatch(space)
  if (error) return { error }

  // There should only be one subscription per provider, but in theory you
  // could have multiple providers for the same consumer (space).
  for (const consumer of consumers) {
    const { ok: subscription, error: err0 } = await subscriptionStore.get(consumer.provider, consumer.subscription)
    if (err0) return { error: err0 }

    const { error: err1 } = await spaceSizeDiffStore.put({
      customer: subscription.customer,
      provider: consumer.provider,
      subscription: subscription.subscription,
      space,
      cause: message.invocationCid,
      change: size,
      // TODO: use receipt timestamp per https://github.com/web3-storage/w3up/issues/970
      receiptAt: message.ts
    })
    if (err1) return { error: err1 }
  }

  return { ok: {} }
}

/**
 * @param {import('../types').UcanStreamMessage} m
 * @returns {m is import('../types').UcanReceiptMessage}
 */
const isReceipt = m => m.type === 'receipt'

/**
 * @param {import('@ucanto/interface').Result} r
 * @returns {r is { ok: import('@web3-storage/capabilities/types').StoreAddSuccess }}
 */
const isStoreAddSuccess = r =>
  !r.error &&
  r.ok != null &&
  typeof r.ok === 'object' &&
  'status' in r.ok &&
  (r.ok.status === 'done' || r.ok.status === 'upload')

/**
 * @param {import('@ucanto/interface').Result} r
 * @returns {r is { ok: import('@web3-storage/capabilities/types').StoreRemoveSuccess }}
 */
const isStoreRemoveSuccess = r =>
  !r.error &&
  r.ok != null &&
  typeof r.ok === 'object' &&
  'size' in r.ok

/**
 * @template {import('@ucanto/interface').Ability} Can
 * @template {import('@ucanto/interface').Unit} Caveats
 * @param {import('../types').UcanReceiptMessage} m
 * @param {import('@ucanto/interface').TheCapabilityParser<import('@ucanto/interface').CapabilityMatch<Can, import('@ucanto/interface').Resource, Caveats>>} cap
 * @returns {m is import('../types').UcanReceiptMessage<[import('@ucanto/interface').Capability<Can, import('@ucanto/interface').Resource, Caveats>]>}
 */
const isReceiptForCapability = (m, cap) => m.value.att.some(c => c.can === cap.can)

/**
 * @param {import('aws-lambda').KinesisStreamEvent} event
 * @returns {import('../types').UcanStreamMessage[]}
 */
const parseUcanStreamEvent = event => {
  const batch = event.Records.map(r => fromString(r.kinesis.data, 'base64'))
  return batch.map(b => {
    const json = JSON.parse(toString(b, 'utf8'))
    return {
      ...json,
      carCid: Link.parse(json.carCid),
      invocationCid: Link.parse(json.invocationCid),
      ts: new Date(json.ts)
    }
  })
}

export const handler = Sentry.AWSLambda.wrapHandler(_handler)
