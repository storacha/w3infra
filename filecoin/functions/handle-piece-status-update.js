import * as Sentry from '@sentry/serverless'
import { Config } from 'sst/node/config'
import { unmarshall } from '@aws-sdk/util-dynamodb'
import * as Proof from '@storacha/client/proof'
import * as DID from '@ipld/dag-ucan/did'

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
 * Get EventRecord from the DynamoDB Stream Event triggering the handler.
 *
 * On piece status updated into store, invoke piece/accept for final receipt.
 *
 * @param {import('aws-lambda').DynamoDBStreamEvent} event 
 */
async function handlePieceStatusUpdate (event) {
  // Parse records
  const eventRawRecords = parseDynamoDbEvent(event)
  // if one we should put back in queue
  if (eventRawRecords.length !== 1) {
    return {
      statusCode: 400,
      body: `Expected 1 DynamoDB record per invocation but received ${eventRawRecords.length}`
    }
  }

  /** @type {PieceStoreRecord} */
  // @ts-expect-error can't figure out type of new
  const storeReecord = unmarshall(eventRawRecords[0].new)
  const record = decodeRecord(storeReecord)

  // Create context
  const { PRIVATE_KEY: privateKey, STOREFRONT_PROOF: storefrontProof } = Config
  const { storefrontDid, storefrontUrl } = getEnv()
  let storefrontSigner = getServiceSigner({
    privateKey
  })
  const connection = getServiceConnection({
    did: storefrontDid,
    url: storefrontUrl
  })
  const storefrontProofs = []
  if (storefrontProof) {
    const proof = await Proof.parse(storefrontProof)
    storefrontProofs.push(proof)
  } else {
    // if no proofs, we must be using the service private key to sign
    storefrontSigner = storefrontSigner.withDID(DID.parse(storefrontDid).did())
  }
  const context = {
    storefrontService: {
      connection,
      invocationConfig: {
        issuer: storefrontSigner,
        with: storefrontSigner.did(),
        audience: storefrontSigner,
        proofs: storefrontProofs
      },
    },
  }

  const { ok, error } = await storefrontEvents.handlePieceStatusUpdate(context, record)
  if (error) {
    return {
      statusCode: 500,
      body: error.message || 'failed to handle piece status update'
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
    storefrontDid: mustGetEnv('STOREFRONT_DID'),
    storefrontUrl: mustGetEnv('STOREFRONT_URL'),
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

export const main = Sentry.AWSLambda.wrapHandler(handlePieceStatusUpdate)
