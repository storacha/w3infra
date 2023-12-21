import * as Sentry from '@sentry/serverless'
import { S3Client } from '@aws-sdk/client-s3'
import { CID } from 'multiformats/cid'

import {
  getSigner,
  carLocationResolver,
  resolveCar,
  resolvePiece,
  redirectTo
} from '../index.js'
import {
  getEnv,
  parseQueryStringParameters,
  parseKeyQueryStringParameters,
} from '../utils.js'

Sentry.AWSLambda.init({
  environment: process.env.SST_STAGE,
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 1.0,
})

/**
 * AWS HTTP Gateway handler for GET /{cid} by CAR CID or an equivalent CID,
 * such as a Piece CID.
 *
 * @param {import('aws-lambda').APIGatewayProxyEventV2} request
 */
export async function redirectCarGet(request) {
  const {
    BUCKET_NAME,
  } = getEnv()

  let cid, expiresIn
  try {
    const parsedQueryParams = parseQueryStringParameters(request.queryStringParameters)
    expiresIn = parsedQueryParams.expiresIn
    const cidString = request.pathParameters?.cid
    cid = CID.parse(cidString || '')
  } catch (err) {
    return { statusCode: 400, body: err.message }
  }

  const locateCar = carLocationResolver({ 
    s3Client: getS3Client(),
    expiresIn,
    defaultBucketName: BUCKET_NAME
  })

  const response = await resolveCar(cid, locateCar) ?? await resolvePiece(cid, locateCar)

  return response ?? {
    statusCode: 415, 
    body: 'Unsupported CID type. Please provide a CAR CID or v2 Piece CID.' 
  }
}

/**
 * AWS HTTP Gateway handler for GET /key/{key} by bucket key.
 * Note that this is currently used by dagcargo old system and
 * should be deprecated once it is decomissioned.
 *
 * @param {import('aws-lambda').APIGatewayProxyEventV2} request
 */
export async function redirectKeyGet(request) {
  const s3Client = getS3Client()

  let key, expiresIn, bucketName
  try {
    const parsedQueryParams = parseKeyQueryStringParameters(request.queryStringParameters)
    expiresIn = parsedQueryParams.expiresIn
    bucketName = parsedQueryParams.bucketName || 'carpark-prod-0'

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
