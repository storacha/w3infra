import * as Sentry from '@sentry/serverless'
import { toString, fromString } from 'uint8arrays'
import * as Link from 'multiformats/link'
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
    if (!deltas.length) return

    const ctx = {
      spaceDiffStore: createSpaceDiffStore({ region }, { tableName: spaceDiffTable }),
      consumerStore: createConsumerStore({ region }, { tableName: consumerTable })
    }
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
