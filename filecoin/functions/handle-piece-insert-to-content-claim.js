import * as Sentry from '@sentry/serverless'
import { Config } from 'sst/node/config'
import { unmarshall } from '@aws-sdk/util-dynamodb'
import * as Delegation from '@ucanto/core/delegation'
import * as Link from 'multiformats/link'
import { base64 } from 'multiformats/bases/base64'
import { equals } from 'multiformats/bytes'
import * as storefrontEvents from '@storacha/filecoin-api/storefront/events'
import { Client as IndexingServiceClient } from '@storacha/indexing-service-client'
import * as DID from '@ipld/dag-ucan'
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
  const { storefrontDid, indexingServiceDid, indexingServiceUrl, claimsServiceDid, claimsServiceUrl } = getEnv()
  const { PRIVATE_KEY: privateKey, INDEXING_SERVICE_PROOF: indexingServiceProof, CONTENT_CLAIMS_PRIVATE_KEY: claimsServicePrivateKey } = Config

  const records = parseDynamoDbEvent(event)
  if (records.length > 1) {
    throw new Error('Should only receive one ferry to update')
  }

  /** @type {PieceStoreRecord} */
  // @ts-expect-error can't figure out type of new
  const storeRecord = unmarshall(records[0].new)
  const record = decodeRecord(storeRecord)

  const indexer = new IndexingServiceClient({
    // @ts-expect-error https://github.com/storacha/js-indexing-service-client/pull/23
    servicePrincipal: DID.parse(indexingServiceDid),
    serviceURL: indexingServiceUrl
  })

  const results = await indexer.queryClaims({ hashes: [record.content.multihash] })
  if (results.error) {
    throw new Error(`failed to query indexer: ${record.content}`, { cause: results.error })
  }
  if (!results.ok.claims.size) {
    throw new Error(`missing location for content: ${record.content}`)
  }

  // uploads to legacy spaces do not have a space DID in their location claim
  let isLegacySpace = true
  for (const claim of results.ok.claims.values()) {
    // if there's already an equals claim we are finished
    if (isEqualsClaimForPieceRecord(claim, record)) {
      return { statusCode: 200, body: {} }
    }
    // if the claim is a location commitment and it has a space DID then it is
    // not a legacy space upload.
    if (claim.type === 'assert/location' && claim.space) {
      isLegacySpace = false
      break
    }
  }

  let context
  // equals claims are published to the indexing service for non-legacy spaces
  if (!isLegacySpace) {
    const connection = getServiceConnection({
      did: indexingServiceDid,
      url: new URL('/claims', indexingServiceUrl),
    })
    const proofBytes = Link.parse(indexingServiceProof, base64).multihash.digest
    const proof = await Delegation.extract(proofBytes)
    if (!proof.ok) throw new Error('failed to extract proof', { cause: proof.error })

    context = {
      claimsService: {
        connection: connection,
        invocationConfig: {
          issuer: getServiceSigner({ privateKey, did: storefrontDid }),
          audience: connection.id,
          with: connection.id.did(),
          proofs: [proof.ok]
        },
      },
    }
  // equals claims are published to the legacy content claims service for legacy spaces
  } else {
    const connection = getServiceConnection({
      did: claimsServiceDid,
      url: new URL(claimsServiceUrl),
    })
    context = {
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
    storefrontDid: mustGetEnv('STOREFRONT_DID'),
    indexingServiceDid: mustGetEnv('INDEXING_SERVICE_DID'),
    indexingServiceUrl: new URL(mustGetEnv('INDEXING_SERVICE_URL')),
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

/**
 * 
 * @param {import('@storacha/indexing-service-client/api').Claim} c
 * @param {import('../store/piece.js').PieceRecord} r
 */
const isEqualsClaimForPieceRecord = (c, r) => {
  if (c.type !== 'assert/equals') {
    return false
  }
  if (equalDigest(c.content, r.content) && equalDigest(c.equals, r.piece)) {
    return true
  }
  if (equalDigest(c.content, r.piece) && equalDigest(c.equals, r.content)) {
    return true
  }
  return false
}

/**
 * @param {import('multiformats').UnknownLink|{ digest: Uint8Array }} content 
 * @param {import('multiformats').UnknownLink} link 
 */
const equalDigest = (content, link) => 'multihash' in content
  ? equals(content.multihash.bytes, link.multihash.bytes)
  : equals(content.digest, link.multihash.bytes)
