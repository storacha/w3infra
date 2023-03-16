import * as Sentry from '@sentry/serverless'

import { createSpaceMetricsTable } from '../tables/space-metrics.js'
import { parseKinesisEvent } from '../utils/parse-kinesis-event.js'
import { STORE_REMOVE } from '../constants.js'

Sentry.AWSLambda.init({
  environment: process.env.SST_STAGE,
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 1.0,
})

const AWS_REGION = process.env.AWS_REGION || 'us-west-2'

/**
 * @typedef {object} IncrementInput
 * @property {`did:${string}:${string}`} space
 * @property {number} count
 */

/**
 * @param {import('aws-lambda').KinesisStreamEvent} event
 */
async function handler(event) {
  const ucanInvocations = parseKinesisEvent(event)

  const {
    TABLE_NAME: tableName = '',
    // set for testing
    DYNAMO_DB_ENDPOINT: dbEndpoint,
  } = process.env

  await updateStoreCount(ucanInvocations, {
    spaceMetricsTable: createSpaceMetricsTable(AWS_REGION, tableName, {
      endpoint: dbEndpoint
    })
  })
}

/**
 * @param {import('../types').UcanInvocation[]} ucanInvocations
 * @param {import('../types').SpaceMetricsTableCtx} ctx
 */
export async function updateStoreCount (ucanInvocations, ctx) {
  const invocationsWithStoreRemove = ucanInvocations.filter(
    inv => inv.value.att.find(a => a.can === STORE_REMOVE)
  ).flatMap(inv => inv.value.att)

  await ctx.spaceMetricsTable.incrementStoreRemoveCount(invocationsWithStoreRemove)
}

export const consumer = Sentry.AWSLambda.wrapHandler(handler)
