import * as Sentry from '@sentry/serverless'

import { replicate } from '../index.js'
import parseSqsEvent from '../utils/parse-sqs-event.js'
import { mustGetEnv } from '../../lib/env.js'
import { getS3Client } from '../../lib/aws/s3.js'

Sentry.AWSLambda.init({
  environment: process.env.SST_STAGE,
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 0,
})

/**
 * Get EventRecord from the SQS Event triggering the handler
 *
 * @param {import('aws-lambda').SQSEvent} event
 */
function replicatorHandler (event) {
  const {
    REPLICATOR_ENDPOINT,
    REPLICATOR_ACCESS_KEY_ID,
    REPLICATOR_SECRET_ACCESS_KEY,
    REPLICATOR_BUCKET_NAME,
  } = getEnv()

  const record = parseSqsEvent(event)
  if (!record) {
    throw new Error('Invalid CAR file format')
  }

  const destinationBucket = getS3Client({
    region: 'auto',
    endpoint: REPLICATOR_ENDPOINT,
    credentials: {
      accessKeyId: REPLICATOR_ACCESS_KEY_ID,
      secretAccessKey: REPLICATOR_SECRET_ACCESS_KEY,
    },
  })

  const originBucket = getS3Client({ region: record.bucketRegion })
  return replicate({
    record,
    destinationBucket,
    originBucket,
    destinationBucketName: REPLICATOR_BUCKET_NAME,
  })
}

export const handler = Sentry.AWSLambda.wrapHandler(replicatorHandler)

/**
 * Get Env validating it is set.
 */
function getEnv() {
  return {
    REPLICATOR_ENDPOINT: mustGetEnv('REPLICATOR_ENDPOINT'),
    REPLICATOR_ACCESS_KEY_ID: mustGetEnv('REPLICATOR_ACCESS_KEY_ID'),
    REPLICATOR_SECRET_ACCESS_KEY: mustGetEnv('REPLICATOR_SECRET_ACCESS_KEY'),
    REPLICATOR_BUCKET_NAME: mustGetEnv('REPLICATOR_BUCKET_NAME')
  }
}
