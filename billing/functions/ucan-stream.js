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
    if (isInvokedCapabiltyReceipt(m, StoreCaps.add, isStoreAddResultOk)) {
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
        cause: Link.parse(m.carCid),
        change: size
      })
    } else if (isInvokedCapabiltyReceipt(m, StoreCaps.remove, isStoreRemoveResultOk)) {
      const customer = await subscriptionsTable.getCustomer()
      if (!customer) {
        throw new Error(`customer not found for space: ${}`)
      }

      records.push({
        customer: customer.did,
        space: m.value.att[0].with,
        cause: Link.parse(m.carCid),
        change: m.out.ok.size
      })
    }
  }
  if (!records.length) return

  await spaceSizeDiffTable.putAll(records)
}

/**
 * @template {import('@ucanto/interface').Ability} Can
 * @template {import('@ucanto/interface').Unit} Caveats
 * @template OkValue
 * @template {{ ok: OkValue }} R
 * @param {import('../types').UcanStreamMessage} m
 * @param {import('@ucanto/interface').TheCapabilityParser<import('@ucanto/interface').CapabilityMatch<Can, import('@ucanto/interface').Resource, Caveats>>} cap
 * @param {(out: unknown) => out is OkValue} isOkValue
 * @returns {m is import('../types').UcanReceiptMessage<[import('@ucanto/interface').Capability<Can, import('@ucanto/interface').Resource, Caveats>], R>}
 */
const isInvokedCapabiltyReceipt = (m, cap, isOkValue) => isResultOk(m, isOkValue) && isReceiptForCapability(m, cap)

/**
 * @param {import('../types').UcanStreamMessage} m
 * @returns {m is import('../types').UcanReceiptMessage}
 */
const isReceipt = m => m.type === 'receipt'

/**
 * @template OkValue
 * @param {import('../types').UcanStreamMessage} m
 * @param {(out: unknown) => out is OkValue} isOkValue
 * @returns {m is import('../types').UcanReceiptMessage}
 */
const isResultOk = (m, isOkValue) => isReceipt(m) && !m.out.error && isOkValue(m.out)

/**
 * @param {any} v
 * @returns {v is import('@web3-storage/capabilities/types').StoreAddSuccess}
 */
const isStoreAddResultOk = v => v?.status === 'done' || v?.status === 'upload'

/**
 * @param {any} v
 * @returns {v is import('@web3-storage/capabilities/types').StoreRemoveSuccess}
 */
const isStoreRemoveResultOk = v => 'size' in v

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
  return batch.map(b => JSON.parse(toString(b, 'utf8')))
}

export const handler = Sentry.AWSLambda.wrapHandler(_handler)
