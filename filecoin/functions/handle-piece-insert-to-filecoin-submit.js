import * as Sentry from '@sentry/serverless'
import { Config } from '@serverless-stack/node/config/index.js'
import { unmarshall } from '@aws-sdk/util-dynamodb'
import * as Delegation from '@ucanto/core/delegation'
import { fromString } from 'uint8arrays/from-string'
import * as DID from '@ipld/dag-ucan/did'

import * as storefrontEvents from '@web3-storage/filecoin-api/storefront/events'

import { decodeRecord } from '../store/piece.js'
import { getServiceConnection, getServiceSigner } from '../service.js'
import { mustGetEnv } from './utils.js'

Sentry.AWSLambda.init({
  environment: process.env.SST_STAGE,
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 1.0,
})

/**
 * @typedef {import('../types').PieceStoreRecord} PieceStoreRecord
 */

/**
 * Get EventRecord from the DynamoDB Stream Event triggering the handler.
 *
 * On piece inserted into store, invoke submit to queue piece to be offered for aggregate.
 *
 * @param {import('aws-lambda').DynamoDBStreamEvent} event 
 */
async function handlePieceInsertToFilecoinSubmit (event) {
  // Parse records
  const eventRawRecords = parseDynamoDbEvent(event)
  // if one we should put back in queue
  if (eventRawRecords.length !== 1) {
    return {
      statusCode: 400,
      body: `Expected 1 DynamoDBStreamEvent per invocation but received ${eventRawRecords.length}`
    }
  }

  /** @type {PieceStoreRecord} */
  // @ts-expect-error can't figure out type of new
  const storeReecord = unmarshall(eventRawRecords[0].new)
  const record = decodeRecord(storeReecord)

  // Create context
  const { PRIVATE_KEY: privateKey } = Config
  const { serviceDid, serviceUrl, did, delegatedProof } = getEnv()
  let storefrontSigner = getServiceSigner({
    privateKey
  })
  const connection = getServiceConnection({
    did: serviceDid,
    url: serviceUrl
  })
  const aggregatorServiceProofs = []
  if (delegatedProof) {
    const proof = await Delegation.extract(fromString(delegatedProof, 'base64pad'))
    if (!proof.ok) throw new Error('failed to extract proof', { cause: proof.error })
    aggregatorServiceProofs.push(proof.ok)
  } else {
    // if no proofs, we must be using the service private key to sign
    storefrontSigner = storefrontSigner.withDID(DID.parse(did).did())
  }
  const context = {
    storefrontService: {
      connection,
      invocationConfig: {
        issuer: storefrontSigner,
        with: storefrontSigner.did(),
        audience: storefrontSigner,
      },
    },
  }

  const { ok, error } = await storefrontEvents.handlePieceInsert(context, record)
  if (error) {
    return {
      statusCode: 500,
      body: error.message || 'failed to handle piece insert event to filecoin submit'
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
    did: mustGetEnv('DID'),
    serviceDid: mustGetEnv('SERVICE_DID'),
    serviceUrl: mustGetEnv('SERVICE_URL'),
    delegatedProof: mustGetEnv('PROOF'),
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

export const main = Sentry.AWSLambda.wrapHandler(handlePieceInsertToFilecoinSubmit)
