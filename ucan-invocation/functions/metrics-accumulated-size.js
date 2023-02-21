import * as Sentry from '@sentry/serverless'

import { createW3MetricsTable } from '../tables/w3-metrics.js'
import { parseKinesisEvent } from '../utils/parse-kinesis-event.js'
import { STORE_ADD } from '../constants.js'

Sentry.AWSLambda.init({
  environment: process.env.SST_STAGE,
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 1.0,
})

const AWS_REGION = process.env.AWS_REGION || 'us-west-2'

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

  await updateAccumulatedSize(ucanInvocations, {
    w3MetricsTable: createW3MetricsTable(AWS_REGION, tableName, {
      endpoint: dbEndpoint
    })
  })
}

/**
 * @param {import('../types').UcanInvocation[]} ucanInvocations
 * @param {import('../types').W3AccumulatedSizeCtx} ctx
 */
export async function updateAccumulatedSize (ucanInvocations, ctx) {
  const invocationsWithStoreAdd = ucanInvocations.filter(
    inv => inv.value.att.find(a => a.can === STORE_ADD)
  ).flatMap(inv => inv.value.att)

  await ctx.w3MetricsTable.incrementAccumulatedSize(invocationsWithStoreAdd)
}

export const consumer = Sentry.AWSLambda.wrapHandler(handler)
