import * as Sentry from '@sentry/serverless'

import { createCarStore } from '../buckets/car-store.js'
import { createSpaceMetricsTable } from '../tables/space-metrics.js'
import { hasOkReceipt } from '../utils/receipt.js'
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
    STORE_BUCKET_NAME: storeBucketName = '',
  } = process.env

  await updateAddSizeTotal(ucanInvocations, {
    spaceMetricsTable: createSpaceMetricsTable(AWS_REGION, tableName),
    carStoreBucket: createCarStore(AWS_REGION, storeBucketName)
  })
}

/**
 * @param {import('../types').UcanInvocation[]} ucanInvocations
 * @param {import('../types').MetricsBySpaceWithBucketCtx} ctx
 */
export async function updateAddSizeTotal (ucanInvocations, ctx) {
  const invocationsWithStoreAdd = ucanInvocations.filter(
    inv => inv.value.att.find(a => a.can === STORE_ADD) && hasOkReceipt(inv)
  ).flatMap(inv => inv.value.att)

  await ctx.spaceMetricsTable.incrementStoreAddSizeTotal(invocationsWithStoreAdd)
}

export const consumer = Sentry.AWSLambda.wrapHandler(handler)
