import * as Sentry from '@sentry/serverless'

import { createSpaceMetricsTable } from '../tables/space-metrics.js'
import { parseKinesisEvent } from '../utils/parse-kinesis-event.js'
import { UPLOAD_REMOVE, CONTENT_TYPE } from '../constants.js'

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

  await updateUploadCount(ucanInvocations, {
    spaceMetricsTable: createSpaceMetricsTable(AWS_REGION, tableName, {
      endpoint: dbEndpoint
    })
  })
}

/**
 * @param {import('../types').UcanInvocation[]} ucanInvocations
 * @param {import('../types').SpaceMetricsTableCtx} ctx
 */
export async function updateUploadCount (ucanInvocations, ctx) {
  const invocationsWithUploadRemove = ucanInvocations.filter(
    inv => inv.value.att.find(a => a.can === UPLOAD_REMOVE) && inv.type === CONTENT_TYPE.RECEIPT
  ).flatMap(inv => inv.value.att)

  await ctx.spaceMetricsTable.incrementUploadRemoveCount(invocationsWithUploadRemove)
}

export const consumer = Sentry.AWSLambda.wrapHandler(handler)
