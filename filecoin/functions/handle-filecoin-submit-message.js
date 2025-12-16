import * as Sentry from '@sentry/serverless'

import * as storefrontEvents from '@storacha/filecoin-api/storefront/events'

import { createPieceTable } from '../store/piece.js'
import { useContentStore } from '../store/content.js'
import { decodeMessage } from '../queue/filecoin-submit-queue.js'
import { mustGetEnv } from '../../lib/env.js'
import { createStorageProviderTable } from '../../upload-api/tables/storage-provider.js'
import { Config } from 'sst/node/config'
import { getServiceSigner } from '../service.js'
import { create as createRoutingService } from '../../upload-api/external-services/router.js'

Sentry.AWSLambda.init({
  environment: process.env.SST_STAGE,
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 0,
})

const AWS_REGION = process.env.AWS_REGION || 'us-west-2'

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
  const privateKey = Config.PRIVATE_KEY

  // create context
  const {
    pieceTableName,
    storageProviderTableName,
    contentStoreHttpEndpoint,
    did
  } = getEnv()

  const storefrontSigner = getServiceSigner({
    did,
    privateKey
  })

  const storageProviderTable = createStorageProviderTable(
    AWS_REGION,
    storageProviderTableName
  )
  const routingService = createRoutingService(
    storageProviderTable,
    storefrontSigner
  )

  const context = {
    pieceStore: createPieceTable(AWS_REGION, pieceTableName),
    contentStore: useContentStore(contentStoreHttpEndpoint),
    router: routingService
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
    storageProviderTableName: mustGetEnv('STORAGE_PROVIDER_TABLE_NAME'),
    contentStoreHttpEndpoint: new URL(
      mustGetEnv('CONTENT_STORE_HTTP_ENDPOINT')
    ),
    did: mustGetEnv('DID')
  }
}

export const main = Sentry.AWSLambda.wrapHandler(handleFilecoinSubmitMessage)
