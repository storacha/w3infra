import { S3Client } from '@aws-sdk/client-s3'
import * as Sentry from '@sentry/serverless'

import { computePieceCid } from '../index.js'
import { mustGetEnv } from './utils.js'
import { createPieceTable } from '../tables/piece.js'

Sentry.AWSLambda.init({
  environment: process.env.SST_STAGE,
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 1.0,
})

const AWS_REGION = process.env.AWS_REGION || 'us-west-2'

/**
 * Get EventRecord from the SQS Event triggering the handler
 *
 * @param {import('aws-lambda').SQSEvent} event
 */
async function computeHandler (event) {
  const {
    pieceTableName,
  } = getEnv()

  const record = parseEvent(event)
  if (!record) {
    throw new Error('Unexpected sqs record format')
  }

  const s3Client = new S3Client({ region: record.bucketRegion })
  const pieceTable = createPieceTable(AWS_REGION, pieceTableName)

  const { error, ok } = await computePieceCid({
    record,
    s3Client,
    pieceTable,
  })

  if (error) {
    console.error(error)

    return {
      statusCode: 500,
      body: error.message
    }
  }

  return {
    statusCode: 200,
    body: ok
  }
}

export const handler = Sentry.AWSLambda.wrapHandler(computeHandler)

/**
 * Get Env validating it is set.
 */
function getEnv () {
  return {
    pieceTableName: mustGetEnv('PIECE_TABLE_NAME'),
  }
}

/**
 * Extract an EventRecord from the passed SQS Event
 *
 * @param {import('aws-lambda').SQSEvent} sqsEvent
 * @returns {import('../index.js').EventRecord | undefined}
 */
function parseEvent (sqsEvent) {
  if (sqsEvent.Records.length !== 1) {
    throw new Error(
      `Expected 1 CAR per invocation but received ${sqsEvent.Records.length} CARs`
    )
  }

  const body = sqsEvent.Records[0].body
  if (!body) {
    return
  }
  const { key, bucketName, bucketRegion } = JSON.parse(body)

  return {
    bucketRegion,
    bucketName,
    key,
  }
}
