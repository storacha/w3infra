import * as Sentry from '@sentry/serverless'
import { S3Client } from '@aws-sdk/client-s3'
import { CID } from 'multiformats/cid'

import { getSigner } from '../index.js'
import { findEquivalentCarCids, asPieceCidV1, asPieceCidV2, asCarCid } from '../piece.js'
import { getEnv, parseQueryStringParameters } from '../utils.js'

Sentry.AWSLambda.init({
  environment: process.env.SST_STAGE,
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 1.0,
})

/**
 * AWS HTTP Gateway handler for GET /{cid} by CAR CID or Piece CID
 *
 * @param {import('aws-lambda').APIGatewayProxyEventV2} request
 */
export async function redirectCarGet(request) {
  const { BUCKET_NAME } = getEnv()
  const s3Client = getS3Client()

  let cid, expiresIn
  try {
    const parsedQueryParams = parseQueryStringParameters(request.queryStringParameters)
    expiresIn = parsedQueryParams.expiresIn
    const cidString = request.pathParameters?.cid
    cid = CID.parse(cidString || '')
  } catch (err) {
    return { statusCode: 400, body: err.message }
  }

  if (asCarCid(cid) !== undefined) {
    const locateCar = carLocationResolver({ s3Client, bucket: BUCKET_NAME, expiresIn })
    const url = locateCar(cid)
    if (url) {
      return redirectTo(url)
    }
    return { statusCode: 404, body: 'CAR Not found'}
  }

  if (asPieceCidV2(cid) !== undefined) {
    const locateCar = carLocationResolver({ s3Client, bucket: BUCKET_NAME, expiresIn })
    const cars = await findEquivalentCarCids(cid)
    if (cars.size === 0) {
      return { statusCode: 404, body: 'No equivalent CAR CID for Piece CID found' }
    }
    for (const cid of cars) {
      const url = locateCar(cid)
      if (url) {
        return redirectTo(url)
      }
    }
    return { statusCode: 404, body: 'No CARs found for Piece CID' }
  }

  if (asPieceCidV1(cid) !== undefined) {
    return {
      statusCode: 415,
      body: 'v1 Piece CIDs are not supported yet. Please provide a V2 Piece CID. https://github.com/filecoin-project/FIPs/blob/master/FRCs/frc-0069.md'
    }
  }

  return {
    statusCode: 415,
    body: 'Unsupported CID type. Please provide a CAR CID or v2 Piece CID.'
  }
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
function carLocationResolver ({ s3Client, bucket, expiresIn }) {
  const signer = getSigner(s3Client, bucket)
  /**
   * @param {CID} cid
   */
  return async function locateCar (cid) {
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

export const handler = Sentry.AWSLambda.wrapHandler(redirectCarGet)
export const keyHandler = Sentry.AWSLambda.wrapHandler(redirectKeyGet)
