import * as Sentry from '@sentry/serverless'
import { Config } from '@serverless-stack/node/config/index.js'
import { unmarshall } from '@aws-sdk/util-dynamodb'
import { Piece } from '@web3-storage/data-segment'
import { CID } from 'multiformats/cid'

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
  const { aggregatorDid, aggregatorUrl, contentClaimsDid, contentClaimsUrl } = getEnv()
  const { PRIVATE_KEY: privateKey, CONTENT_CLAIMS_PRIVATE_KEY: contentClaimsPrivateKey } = Config

  const records = parseDynamoDbEvent(event)
  if (records.length > 1) {
    throw new Error('Should only receive one ferry to update')
  }

  // @ts-expect-error can't figure out type of new
  const pieceRecord = unmarshall(records[0].new)
  const piece = Piece.fromString(pieceRecord.piece).link
  const content = CID.parse(pieceRecord.link)

  const aggregateServiceConnection = getServiceConnection({
    did: aggregatorDid,
    url: aggregatorUrl
  })
  const claimsServiceConnection = getServiceConnection({
    did: contentClaimsDid,
    url: contentClaimsUrl
  })
  const storefrontIssuer = getServiceSigner({
    privateKey
  })
  const claimsIssuer = getServiceSigner({
    privateKey: contentClaimsPrivateKey
  })

  const { ok, error } = await reportPieceCid({
    piece,
    content,
    group: storefrontIssuer.did(),
    aggregateServiceConnection,
    aggregateInvocationConfig: /** @type {import('@web3-storage/filecoin-client/types').InvocationConfig} */ ({
      issuer: storefrontIssuer,
      audience: aggregateServiceConnection.id,
      with: storefrontIssuer.did(),
    }),
    claimsServiceConnection,
    claimsInvocationConfig: /** @type {import('../types').ClaimsInvocationConfig} */ ({
      issuer: claimsIssuer,
      audience: claimsServiceConnection.id,
      with: claimsIssuer.did(),
    })
  })

  if (error) {
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

export const handler = Sentry.AWSLambda.wrapHandler(pieceCidReport)

/**
 * Get Env validating it is set.
 */
function getEnv() {
  return {
    aggregatorDid: mustGetEnv('AGGREGATOR_DID'),
    aggregatorUrl: mustGetEnv('AGGREGATOR_URL'),
    contentClaimsDid: mustGetEnv('CONTENT_CLAIMS_DID'),
    contentClaimsUrl: mustGetEnv('CONTENT_CLAIMS_URL'),
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