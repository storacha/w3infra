import * as Sentry from '@sentry/serverless'
import { fromString } from 'uint8arrays/from-string'
import * as DAGJson from '@ipld/dag-json'

import { updateAggregateOfferTotal, updateAggregateAcceptTotal } from '../metrics.js'
import { createWorkflowStore } from '../store/workflow.js'
import { createInvocationStore } from '../store/invocation.js'
import { createFilecoinMetricsTable } from '../store/metrics.js'
import { mustGetEnv } from '../../lib/env.js'

Sentry.AWSLambda.init({
  environment: process.env.SST_STAGE,
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 0,
})

const AWS_REGION = process.env.AWS_REGION || 'us-west-2'

/**
 * @param {import('aws-lambda').KinesisStreamEvent} event
 */
async function handler(event) {
  const ucanInvocations = parseKinesisEvent(event)
  const {
    metricsTableName,
    invocationBucketName,
    workflowBucketName,
    startEpochMs
  } = getLambdaEnv()

  const filecoinMetricsStore = createFilecoinMetricsTable(AWS_REGION, metricsTableName)
  const workflowStore = createWorkflowStore(AWS_REGION, workflowBucketName)
  const invocationStore = createInvocationStore(AWS_REGION, invocationBucketName)

  await Promise.all([
    updateAggregateOfferTotal(ucanInvocations, {
      filecoinMetricsStore,
      workflowStore,
      invocationStore,
      startEpochMs
    }),
    updateAggregateAcceptTotal(ucanInvocations, {
      filecoinMetricsStore,
      workflowStore,
      startEpochMs
    })
  ])
}

function getLambdaEnv () {
  return {
    metricsTableName: mustGetEnv('METRICS_TABLE_NAME'),
    workflowBucketName: mustGetEnv('WORKFLOW_BUCKET_NAME'),
    invocationBucketName: mustGetEnv('INVOCATION_BUCKET_NAME'),
    startEpochMs: process.env.START_FILECOIN_METRICS_EPOCH_MS ? parseInt(process.env.START_FILECOIN_METRICS_EPOCH_MS) : undefined
  }
}

export const consumer = Sentry.AWSLambda.wrapHandler(handler)

/**
 * @param {import('aws-lambda').KinesisStreamEvent} event
 */
function parseKinesisEvent (event) {
  const batch = event.Records.map(r => fromString(r.kinesis.data, 'base64'))
  return batch.map(b => DAGJson.decode(b))
}
