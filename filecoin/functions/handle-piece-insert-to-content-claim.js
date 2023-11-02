import * as Sentry from '@sentry/serverless'
import { Config } from '@serverless-stack/node/config/index.js'
import { unmarshall } from '@aws-sdk/util-dynamodb'
import { Piece } from '@web3-storage/data-segment'
import { CID } from 'multiformats/cid'
import * as Delegation from '@ucanto/core/delegation'
import { fromString } from 'uint8arrays/from-string'
import * as DID from '@ipld/dag-ucan/did'

import { reportPieceCid } from '../index.js'
import { getServiceConnection, getServiceSigner } from '../service.js'
import { mustGetEnv } from './utils.js'

Sentry.AWSLambda.init({
  environment: process.env.SST_STAGE,
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 1.0,
})

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

  // @ts-expect-error can't figure out type of new
  const pieceRecord = unmarshall(records[0].new)
  const piece = Piece.fromString(pieceRecord.piece).link
  const content = CID.parse(pieceRecord.link)

  const claimsServiceConnection = getServiceConnection({
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

  const { ok, error } = await reportPieceCid({
    piece,
    content,
    claimsServiceConnection,
    claimsInvocationConfig: /** @type {import('../types.js').ClaimsInvocationConfig} */ ({
      issuer: claimsIssuer,
      audience: claimsServiceConnection.id,
      with: claimsIssuer.did(),
      proofs: claimsProofs
    })
  })

  if (error) {
    console.error(error)

    return {
      statusCode: 500,
      body: error.message || 'failed to add aggregate'
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