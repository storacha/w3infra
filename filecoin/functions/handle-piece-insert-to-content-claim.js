import * as Sentry from '@sentry/serverless'
import { Config } from 'sst/node/config'
import { unmarshall } from '@aws-sdk/util-dynamodb'
import * as storefrontEvents from '@storacha/filecoin-api/storefront/events'
import { decodeRecord } from '../store/piece.js'
import { getServiceConnection, getServiceSigner } from '../service.js'
import { mustGetEnv } from '../../lib/env.js'

Sentry.AWSLambda.init({
  environment: process.env.SST_STAGE,
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 0,
})

/**
 * @typedef {import('../types.js').PieceStoreRecord} PieceStoreRecord
 */

/**
 * @param {import('aws-lambda').DynamoDBStreamEvent} event
 */
async function pieceCidReport (event) {
  const { claimsServiceDid, claimsServiceUrl } = getEnv()
  const { CONTENT_CLAIMS_PRIVATE_KEY: claimsServicePrivateKey } = Config

  const records = parseDynamoDbEvent(event)
  if (records.length > 1) {
    throw new Error('Should only receive one ferry to update')
  }

  /** @type {PieceStoreRecord} */
  // @ts-expect-error can't figure out type of new
  const storeRecord = unmarshall(records[0].new)
  const record = decodeRecord(storeRecord)

  const connection = getServiceConnection({
    did: claimsServiceDid,
    url: new URL(claimsServiceUrl)
  })

  const context = {
    claimsService: {
      connection,
      invocationConfig: {
        issuer: getServiceSigner({ privateKey: claimsServicePrivateKey, did: claimsServiceDid }),
        audience: connection.id,
        with: connection.id.did(),
        proofs: []
      },
    },
  }

  const { ok, error } = await storefrontEvents.handlePieceInsertToEquivalencyClaim(context, record)
  if (error) {
    console.error(error)
    return {
      statusCode: 500,
      body: error.message || 'failed to handle piece insert event to content claim'
    }
  }

  return {
    statusCode: 200,
    body: ok
  }
}

export const main = Sentry.AWSLambda.wrapHandler(pieceCidReport)

/**
 * Get Env validating it is set.
 */
function getEnv() {
  return {
    claimsServiceDid: mustGetEnv('CONTENT_CLAIMS_DID'),
    claimsServiceUrl: new URL(mustGetEnv('CONTENT_CLAIMS_URL')),
  }
}

/**
 * @param {import('aws-lambda').DynamoDBStreamEvent} event
 */
function parseDynamoDbEvent (event) {
  return event.Records.map(r => ({
    new: r.dynamodb?.NewImage,
    old: r.dynamodb?.OldImage
  }))
}