import * as Sentry from '@sentry/serverless'
import { toString } from 'uint8arrays/to-string'
import { fromString } from 'uint8arrays/from-string'
import * as DAGJson from '@ipld/dag-json'

import { updateAggregateOfferTotal, updateAggregateAcceptTotal } from '../metrics.js'
import { createWorkflowStore } from '../store/workflow.js'
import { createInvocationStore } from '../store/invocation.js'
import { createFilecoinMetricsTable } from '../store/metrics.js'
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
    invocationBucketName,
    workflowBucketName
  } = getLambdaEnv()

  await updateAggregateOfferTotal(ucanInvocations, {
    filecoinMetricsStore: createFilecoinMetricsTable(AWS_REGION, metricsTableName),
    workflowStore: createWorkflowStore(AWS_REGION, workflowBucketName),
    invocationStore: createInvocationStore(AWS_REGION, invocationBucketName)
  })

  await updateAggregateAcceptTotal(ucanInvocations, {
    filecoinMetricsStore: createFilecoinMetricsTable(AWS_REGION, metricsTableName),
    workflowStore: createWorkflowStore(AWS_REGION, workflowBucketName),
  })
}

function getLambdaEnv () {
  return {
    metricsTableName: mustGetEnv('METRICS_TABLE_NAME'),
    workflowBucketName: mustGetEnv('WORKFLOW_BUCKET_NAME'),
    invocationBucketName: mustGetEnv('INVOCATION_BUCKET_NAME'),
  }
}

export const consumer = Sentry.AWSLambda.wrapHandler(handler)

/**
 * @param {import('aws-lambda').KinesisStreamEvent} event
 */
function parseKinesisEvent (event) {
  const batch = event.Records.map(r => fromString(r.kinesis.data, 'base64'))
  return batch.map(b => DAGJson.parse(toString(b, 'utf8')))
}
