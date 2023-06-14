import * as Sentry from '@sentry/serverless'
import { S3Client } from '@aws-sdk/client-s3'
import { CID } from 'multiformats/cid'

import { getSigner } from '../index.js'
import { getEnv } from '../utils.js'

Sentry.AWSLambda.init({
  environment: process.env.SST_STAGE,
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 1.0,
})

/**
 * AWS HTTP Gateway handler for GET /{cid}
 *
 * @param {import('aws-lambda').APIGatewayProxyEventV2} request
 */
export async function redirectGet(request) {
  const {
    BUCKET_ENDPOINT,
    BUCKET_REGION,
    BUCKET_ACCESS_KEY_ID,
    BUCKET_SECRET_ACCESS_KEY,
    BUCKET_BUCKET_NAME,
  } = getEnv()

  const cidString = request.pathParameters?.cid
  let cid
  try {
    cid = CID.parse(cidString || '')
  } catch {
    return {
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

  const signer = getSigner(s3Client, BUCKET_BUCKET_NAME)
  const signedUrl = await signer.getUrl(cid)
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

export const handler = Sentry.AWSLambda.wrapHandler(redirectGet)
