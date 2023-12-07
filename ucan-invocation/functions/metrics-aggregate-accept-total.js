import * as Sentry from '@sentry/serverless'

import { updateAggregateAcceptTotal } from '../filecoin.js'
import { createWorkflowStore } from '../buckets/workflow-store.js'
import { createFilecoinMetricsTable } from '../stores/filecoin-metrics.js'
import { parseKinesisEvent } from '../utils/parse-kinesis-event.js'
import { mustGetEnv } from './utils.js'

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
    metricsTableName,
    workflowBucketName,
  } = getLambdaEnv()

  await updateAggregateAcceptTotal(ucanInvocations, {
    filecoinMetricsStore: createFilecoinMetricsTable(AWS_REGION, metricsTableName),
    workflowStore: createWorkflowStore(AWS_REGION, workflowBucketName),
  })
}

function getLambdaEnv () {
  return {
    metricsTableName: mustGetEnv('METRICS_TABLE_NAME'),
    workflowBucketName: mustGetEnv('WORKFLOW_BUCKET_NAME'),
  }
}

export const consumer = Sentry.AWSLambda.wrapHandler(handler)
