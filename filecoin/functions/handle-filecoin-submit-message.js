import * as Sentry from '@sentry/serverless'

import * as storefrontEvents from '@web3-storage/filecoin-api/storefront/events'

import { createPieceTable } from '../store/piece.js'
import { createDataStore, composeDataStoresWithOrderedStream } from '../store/data.js'
import { decodeMessage } from '../queue/filecoin-submit-queue.js'
import { mustGetEnv } from './utils.js'

Sentry.AWSLambda.init({
  environment: process.env.SST_STAGE,
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 1.0,
})

const AWS_REGION = process.env.AWS_REGION || 'us-west-2'
const R2_REGION = process.env.R2_REGION || 'auto'

/**
 * Get EventRecord from the SQS Event triggering the handler.
 * On piece offer queue message, offer piece for aggregation.
 *
 * @param {import('aws-lambda').SQSEvent} sqsEvent
 */
async function handleFilecoinSubmitMessage (sqsEvent) {
  if (sqsEvent.Records.length !== 1) {
    return {
      statusCode: 400,
      body: `Expected 1 SQS message per invocation but received ${sqsEvent.Records.length}`
    }
  }

  // Parse record
  const record = decodeMessage({
    MessageBody: sqsEvent.Records[0].body
  })

  // create context
  const {
    pieceTableName,
    s3BucketName,
    r2BucketName,
    r2BucketEndpoint,
    r2BucketAccessKeyId,
    r2BucketSecretAccessKey
  } = getEnv()
  const context = {
    pieceStore: createPieceTable(AWS_REGION, pieceTableName),
    dataStore: composeDataStoresWithOrderedStream(
      createDataStore(AWS_REGION, s3BucketName),
      createDataStore(R2_REGION, r2BucketName, {
        endpoint: r2BucketEndpoint,
        credentials: {
          accessKeyId: r2BucketAccessKeyId,
          secretAccessKey: r2BucketSecretAccessKey,
        },
      })
    )
  }

  const { ok, error } = await storefrontEvents.handleFilecoinSubmitMessage(context, record)
  if (error) {
    return {
      statusCode: 500,
      body: error.message || 'failed to handle filecoin submit message'
    }
  }

  return {
    statusCode: 200,
    body: ok
  }
}

/**
 * Get Env validating it is set.
 */
function getEnv () {
  return {
    pieceTableName: mustGetEnv('PIECE_TABLE_NAME'),
    // carpark buckets - CAR file bytes may be found here with keys like {cid}/{cid}.car
    s3BucketName: mustGetEnv('STORE_BUCKET_NAME'),
    r2BucketName: mustGetEnv('R2_CARPARK_BUCKET_NAME'),
    r2BucketEndpoint: mustGetEnv('R2_ENDPOINT'),
    r2BucketAccessKeyId: mustGetEnv('R2_ACCESS_KEY_ID'),
    r2BucketSecretAccessKey: mustGetEnv('R2_SECRET_ACCESS_KEY'),
  }
}

export const main = Sentry.AWSLambda.wrapHandler(handleFilecoinSubmitMessage)
