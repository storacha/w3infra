import * as Sentry from '@sentry/serverless'
import { S3Client } from '@aws-sdk/client-s3'
import { CID } from 'multiformats/cid'

import { getSigner } from '../index.js'
import { findEquivalentCids, asPieceCidV1, asPieceCidV2 } from '../piece.js'
import { getEnv, parseQueryStringParameters } from '../utils.js'

Sentry.AWSLambda.init({
  environment: process.env.SST_STAGE,
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 1.0,
})

/**
 * AWS HTTP Gateway handler for GET /{cid} by CID or Piece CID
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
  } catch (err) {
    return { statusCode: 400, body: err.message }
  }

  const locateContent = contentLocationResolver({ 
    bucket: getEnv().BUCKET_NAME,
    s3Client: getS3Client(),
    expiresIn
  })

  let response
  if (asPieceCidV2(cid) !== undefined) {
    response = await resolvePiece(cid, locateContent)
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
 * @param {CID} cid
 * @param {(cid: CID) => Promise<string | undefined> } locateContent
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
 * @param {CID} cid
 * @param {(cid: CID) => Promise<string | undefined> } locateContent
 */
async function resolvePiece (cid, locateContent) {
  const cids = await findEquivalentCids(cid)
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
 * Creates a helper function that returns signed bucket url for a car cid, 
 * or undefined if the CAR does not exist in the bucket.
 *
 * @param {object} config
 * @param {S3Client} config.s3Client
 * @param {string} config.bucket
 * @param {number} config.expiresIn
 */
function contentLocationResolver ({ s3Client, bucket, expiresIn }) {
  const signer = getSigner(s3Client, bucket)
  /**
   * @param {CID} cid
   */
  return async function locateContent (cid) {
    const key = `${cid}/${cid}.car`
    return signer.getUrl(key, { expiresIn })
  }
}

/**
 * AWS HTTP Gateway handler for GET /key/{key} by bucket key
 *
 * @param {import('aws-lambda').APIGatewayProxyEventV2} request
 */
export async function redirectKeyGet(request) {
  const s3Client = getS3Client()

  let key, expiresIn, bucketName
  try {
    const parsedQueryParams = parseQueryStringParameters(request.queryStringParameters)
    expiresIn = parsedQueryParams.expiresIn
    bucketName = parsedQueryParams.bucketName

    key = request.pathParameters?.key
    if (!key) {
      throw new Error('no path key provided')
    }

  } catch (err) {
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

function getS3Client(){
  const {
    BUCKET_ENDPOINT,
    BUCKET_REGION,
    BUCKET_ACCESS_KEY_ID,
    BUCKET_SECRET_ACCESS_KEY,
  } = getEnv()

  return new S3Client({
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
