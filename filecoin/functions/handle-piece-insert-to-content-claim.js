import * as Sentry from '@sentry/serverless'
import { Config } from 'sst/node/config'
import { unmarshall } from '@aws-sdk/util-dynamodb'
import * as Delegation from '@ucanto/core/delegation'
import { fromString } from 'uint8arrays/from-string'
import * as DID from '@ipld/dag-ucan/did'

import * as storefrontEvents from '@web3-storage/filecoin-api/storefront/events'

import { decodeRecord } from '../store/piece.js'
import { getServiceConnection, getServiceSigner } from '../service.js'
import { mustGetEnv } from '../../lib/env.js'

Sentry.AWSLambda.init({
  environment: process.env.SST_STAGE,
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 0,
})

/**
 * @typedef {import('../types').PieceStoreRecord} PieceStoreRecord
 */

/**
 * @param {import('aws-lambda').DynamoDBStreamEvent} event
 */
async function pieceCidReport (event) {
  const { contentClaimsDid, contentClaimsUrl, contentClaimsProof } = getEnv()
  const { CONTENT_CLAIMS_PRIVATE_KEY: contentClaimsPrivateKey } = Config

  const records = parseDynamoDbEvent(event)
  if (records.length > 1) {
    throw new Error('Should only receive one ferry to update')
  }

  /** @type {PieceStoreRecord} */
  // @ts-expect-error can't figure out type of new
  const storeRecord = unmarshall(records[0].new)
  const record = decodeRecord(storeRecord)

  const connection = getServiceConnection({
    did: contentClaimsDid,
    url: contentClaimsUrl
  })
  let claimsIssuer = getServiceSigner({
    privateKey: contentClaimsPrivateKey
  })
  const claimsProofs = []
  if (contentClaimsProof) {
    const proof = await Delegation.extract(fromString(contentClaimsProof, 'base64pad'))
      if (!proof.ok) throw new Error('failed to extract proof', { cause: proof.error })
      claimsProofs.push(proof.ok)
  } else {
    // if no proofs, we must be using the service private key to sign
    claimsIssuer = claimsIssuer.withDID(DID.parse(contentClaimsDid).did())
  }

  const context = {
    claimsService: {
      connection,
      invocationConfig: {
        issuer: claimsIssuer,
        audience: connection.id,
        with: claimsIssuer.did(),
        proofs: claimsProofs
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
    contentClaimsDid: mustGetEnv('CONTENT_CLAIMS_DID'),
    contentClaimsUrl: mustGetEnv('CONTENT_CLAIMS_URL'),
    contentClaimsProof: process.env.CONTENT_CLAIMS_PROOF,
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