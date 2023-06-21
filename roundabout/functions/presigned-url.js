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
 * AWS HTTP Gateway handler for GET /presigned-url/{cid}
 * A presigned URL for the given CID is 
 *
 * @param {import('aws-lambda').APIGatewayProxyEventV2} request
 */
export async function presignedUrlGet(request) {
  const {
    BUCKET_ENDPOINT,
    BUCKET_REGION,
    BUCKET_ACCESS_KEY_ID,
    BUCKET_SECRET_ACCESS_KEY,
    BUCKET_NAME,
  } = getEnv()

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

  const s3Client = new S3Client({
    region: BUCKET_REGION,
    endpoint: BUCKET_ENDPOINT,
    credentials: {
      accessKeyId: BUCKET_ACCESS_KEY_ID,
      secretAccessKey: BUCKET_SECRET_ACCESS_KEY,
    },
  })

  const signer = getSigner(s3Client, BUCKET_NAME)
  const signedUrl = await signer.getUrl(cid, {
    expiresIn
  })

  if (!signedUrl) {
    return {
      statusCode: 404
    }
  }

  return {
    statusCode: 200,
    body: signedUrl
  }
}

export const handler = Sentry.AWSLambda.wrapHandler(presignedUrlGet)
