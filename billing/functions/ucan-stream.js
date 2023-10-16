import * as Sentry from '@sentry/serverless'
import { toString, fromString } from 'uint8arrays'
import * as StoreCaps from '@web3-storage/capabilities/store'
import * as Link from 'multiformats/link'
import { createSpaceSizeDiffTable } from '../tables/space-size-diff.js'

Sentry.AWSLambda.init({
  environment: process.env.SST_STAGE,
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 1.0
})

const AWS_REGION = process.env.AWS_REGION || 'us-west-2'

/**
 * @typedef {object} IncrementInput
 * @property {`did:${string}:${string}`} space
 * @property {number} count
 */

/** @param {import('aws-lambda').KinesisStreamEvent} event */
const _handler = async (event) => {
  const {
    TABLE_NAME: tableName = '',
    // set for testing
    DYNAMO_DB_ENDPOINT: dbEndpoint,
  } = process.env

  const messages = parseUcanStreamEvent(event)

  await putSpaceSizeDiffs(messages, {
    spaceSizeDiffTable: createSpaceSizeDiffTable(AWS_REGION, tableName, {
      endpoint: dbEndpoint
    })
  })
}

/**
 * @param {import('../types').UcanStreamMessage[]} messages
 * @param {import('../types').SpaceMetricsTableCtx} ctx
 */
export async function putSpaceSizeDiffs (messages, { spaceSizeDiffTable, subscriptionsTable }) {
  /** @type {import('../types').SpaceSizeDiffRecord[]} */
  const records = []

  for (const m of messages) {
    if (!isReceipt(m)) continue
    if (isReceiptForCapability(m, StoreCaps.add) && isStoreAddSuccess(m.out)) {
      const size = m.value.att[0].nb?.size
      if (!size) {
        throw new Error(`store/add invocation is missing size: ${m.carCid}`)
      }

      const customer = await subscriptionsTable.getCustomer(m.out.ok.with)
      if (!customer) {
        throw new Error(`customer not found for space: ${m.out.ok.with}`)
      }

      records.push({
        customer: customer.did,
        space: m.out.ok.with,
        cause: m.invocationCid,
        change: size
      })
    } else if (isReceiptForCapability(m, StoreCaps.remove) && isStoreRemoveSuccess(m.out)) {
      const space = m.value.att[0].with
      const customer = await subscriptionsTable.getCustomer(space)
      if (!customer) {
        throw new Error(`customer not found for space: ${space}`)
      }

      records.push({
        customer: customer.did,
        // @ts-expect-error URI is not a DID
        space,
        cause: m.invocationCid,
        change: m.out.ok.size
      })
    }
  }
  if (!records.length) return

  await spaceSizeDiffTable.putAll(records)
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
      invocationCid: Link.parse(json.invocationCid)
    }
  })
}

export const handler = Sentry.AWSLambda.wrapHandler(_handler)
