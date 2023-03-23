import * as Sentry from '@sentry/serverless'

import { createCarStore } from '../buckets/car-store.js'
import { createMetricsTable } from '../tables/metrics.js'
import { parseKinesisEvent } from '../utils/parse-kinesis-event.js'
import { STORE_REMOVE, STREAM_TYPE } from '../constants.js'

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
    STORE_BUCKET_NAME: storeBucketName = '',
  } = process.env

  await updateRemoveSizeTotal(ucanInvocations, {
    metricsTable: createMetricsTable(AWS_REGION, tableName),
    carStoreBucket: createCarStore(AWS_REGION, storeBucketName)
  })
}

/**
 * @param {import('../types').UcanInvocation[]} ucanInvocations
 * @param {import('../types').RemoveSizeCtx} ctx
 */
export async function updateRemoveSizeTotal (ucanInvocations, ctx) {
  const invocationsWithStoreRemove = ucanInvocations.filter(
    inv => inv.value.att.find(a => a.can === STORE_REMOVE) && inv.type === STREAM_TYPE.RECEIPT
  ).flatMap(inv => inv.value.att)

  // TODO: once we have receipts for store/remove, replace this
  // Temporary adaptor to set size in invocation
  for (const inv of invocationsWithStoreRemove) {
    // @ts-ignore remove invocations always have link
    const size = await ctx.carStoreBucket.getSize(inv.nb?.link)

    // @ts-ignore
    inv.nb.size = size
  }

  await ctx.metricsTable.incrementStoreRemoveSizeTotal(invocationsWithStoreRemove)
}

export const consumer = Sentry.AWSLambda.wrapHandler(handler)
