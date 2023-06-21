import * as Sentry from '@sentry/serverless'
import { S3Client } from '@aws-sdk/client-s3'
import { CID } from 'multiformats/cid'

import { getSigner } from '../index.js'
import { getEnv, parseQueryStringParameters } from '../utils.js'

Sentry.AWSLambda.init({
  environment: process.env.SST_STAGE,
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 1.0,
})

/**
 * AWS HTTP Gateway handler for GET /{cid} by car CID
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
    return {
      body: err.message,
      statusCode: 400
    }
  }

  const signer = getSigner(s3Client, BUCKET_NAME)
  const key = `${cid}/${cid}.car`
  const signedUrl = await signer.getUrl(key, {
    expiresIn
  })
  
  return toLambdaResponse(signedUrl)
}

/**
 * AWS HTTP Gateway handler for GET /raw/{key} by bucket key
 *
 * @param {import('aws-lambda').APIGatewayProxyEventV2} request
 */
export async function redirectRawGet(request) {
  const { BUCKET_NAME } = getEnv()
  const s3Client = getS3Client()

  let key, expiresIn, bucketName
  try {
    const parsedQueryParams = parseQueryStringParameters(request.queryStringParameters)
    expiresIn = parsedQueryParams.expiresIn
    bucketName = parsedQueryParams.bucketName || BUCKET_NAME

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

  return {
    statusCode: 302,
    headers: {
      Location: signedUrl
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
export const rawHandler = Sentry.AWSLambda.wrapHandler(redirectRawGet)
