import * as Sentry from '@sentry/serverless'
import { CID } from 'multiformats/cid'
import { Client } from '@storacha/indexing-service-client'
import { combine } from '@storacha/indexing-service-client/util'

import { getSigner, contentLocationResolver } from '../index.js'
import { findEquivalentCids, asPieceCidV1, asPieceCidV2 } from '../piece.js'
import { getEnv, parseQueryStringParameters } from '../utils.js'
import { getS3Client } from '../../lib/aws/s3.js'

/**
 * @import { UnknownLink } from 'multiformats'
 * @import { IndexingServiceQueryClient } from '@storacha/indexing-service-client/api'
 */

Sentry.AWSLambda.init({
  environment: process.env.SST_STAGE,
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 0,
})

/**
 * AWS HTTP Gateway handler for GET /{cid} by CAR CID, RAW CID or Piece CID
 *
 * @param {import('aws-lambda').APIGatewayProxyEventV2} request
 */
export async function redirectGet(request) {
  let cid, expiresIn
  try {
    const parsedQueryParams = parseQueryStringParameters(request.queryStringParameters)
    expiresIn = parsedQueryParams.expiresIn
    const cidString = request.pathParameters?.cid
    cid = CID.parse(cidString || '')
  } catch (/** @type {any} */ err) {
    return { statusCode: 400, body: err.message }
  }

  /** @type {string[]} */
  const indexingServiceURLs = JSON.parse(process.env.ROUNDABOUT_INDEXING_SERVICE_URLS ?? '[]')
  if (!indexingServiceURLs.length && process.env.SST_STAGE !== 'prod') {
    indexingServiceURLs.push('https://staging.indexer.storacha.network')
  }

  let indexingService
  if (indexingServiceURLs.length > 1) {
    const clients = indexingServiceURLs.map(u => new Client({ serviceURL: new URL(u) }))
    indexingService = combine(clients)
  } else {
    const url = indexingServiceURLs[0] ? new URL(indexingServiceURLs[0]): undefined
    indexingService = new Client({ serviceURL: url })
  }

  const locateContent = contentLocationResolver({ 
    bucket: getEnv().BUCKET_NAME,
    s3Client: getBucketClient(),
    expiresIn,
    indexingService
  })

  let response
  if (asPieceCidV2(cid) !== undefined) {
    response = await resolvePiece(cid, locateContent, indexingService)
  } else if (asPieceCidV1(cid) !== undefined) {
    response = {
      statusCode: 415,
      body: 'v1 Piece CIDs are not supported yet. Please provide a V2 Piece CID. https://github.com/filecoin-project/FIPs/blob/master/FRCs/frc-0069.md'
    }
  } else {
    response = await resolveContent(cid, locateContent)
  }

  return response ?? {
    statusCode: 415, 
    body: 'Unsupported CID type' 
  }
}

/**
 * Return response for a content CID
 * 
 * @param {UnknownLink} cid
 * @param {(cid: UnknownLink) => Promise<string | undefined> } locateContent
 */
async function resolveContent (cid, locateContent) {
  const url = await locateContent(cid)
    if (url) {
      return redirectTo(url)
    }
    return { statusCode: 404, body: 'Content Not found'}
}

/**
 * Return response for a Piece CID, or undefined for other CID types
 * 
 * @param {UnknownLink} cid
 * @param {(cid: UnknownLink) => Promise<string | undefined> } locateContent
 * @param {IndexingServiceQueryClient} [indexingService]
 */
async function resolvePiece (cid, locateContent, indexingService) {
  const cids = await findEquivalentCids(cid, indexingService)
  if (cids.size === 0) {
    return { statusCode: 404, body: 'No equivalent CID for Piece CID found' }
  }
  for (const cid of cids) {
    const url = await locateContent(cid)
    if (url) {
      return redirectTo(url)
    }
  }
  return { statusCode: 404, body: 'No content found for Piece CID' }
}

/**
 * AWS HTTP Gateway handler for GET /key/{key} by bucket key
 *
 * @param {import('aws-lambda').APIGatewayProxyEventV2} request
 */
export async function redirectKeyGet(request) {
  const s3Client = getBucketClient()

  let key, expiresIn, bucketName
  try {
    const parsedQueryParams = parseQueryStringParameters(request.queryStringParameters)
    expiresIn = parsedQueryParams.expiresIn
    bucketName = parsedQueryParams.bucketName

    key = request.pathParameters?.key
    if (!key) {
      throw new Error('no path key provided')
    }
    if (!bucketName) {
      throw new Error('no bucket name provided')
    }
  } catch (/** @type {any} */ err) {
    return {
      body: err.message,
      statusCode: 400
    }
  }

  const signer = getSigner(s3Client, bucketName)
  const signedUrl = await signer.getUrl(key, {
    expiresIn
  })
  
  return toLambdaResponse(signedUrl)
}

/**
 * @param {string | undefined} signedUrl 
 */
function toLambdaResponse(signedUrl) {
  if (!signedUrl) {
    return {
      statusCode: 404
    }
  }
  return redirectTo(signedUrl)
}

/**
 * @param {string} url
 */
function redirectTo (url) {
  return {
    statusCode: 302,
    headers: {
      Location: url
    }
  }
}

function getBucketClient () {
  const {
    BUCKET_ENDPOINT,
    BUCKET_REGION,
    BUCKET_ACCESS_KEY_ID,
    BUCKET_SECRET_ACCESS_KEY,
  } = getEnv()

  return getS3Client({
    region: BUCKET_REGION,
    endpoint: BUCKET_ENDPOINT,
    credentials: {
      accessKeyId: BUCKET_ACCESS_KEY_ID,
      secretAccessKey: BUCKET_SECRET_ACCESS_KEY,
    },
  })
}

export const handler = Sentry.AWSLambda.wrapHandler(redirectGet)
export const keyHandler = Sentry.AWSLambda.wrapHandler(redirectKeyGet)
