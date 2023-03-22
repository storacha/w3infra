import { Config } from '@serverless-stack/node/config/index.js'
import { Kinesis } from '@aws-sdk/client-kinesis'
import * as Sentry from '@sentry/serverless'

import { createUcanStore } from '../buckets/ucan-store.js'
import { processUcanLogRequest } from '../ucan-invocation.js'

Sentry.AWSLambda.init({
  environment: process.env.SST_STAGE,
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 1.0,
})

const kinesisClient = new Kinesis({})
const AWS_REGION = process.env.AWS_REGION || 'us-west-2'



/**
 * AWS HTTP Gateway handler for POST / with ucan invocation router.
 *
 * We provide responses in Payload format v2.0
 * see: https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-develop-integrations-lambda.html#http-api-develop-integrations-lambda.proxy-format
 *
 * @param {import('aws-lambda').APIGatewayProxyEventV2} request
 */
async function handlerFn(request) {
  const {
    UCAN_BUCKET_NAME: bucketName = '',
    UCAN_LOG_STREAM_NAME: streamName = '',
  } = process.env

  const { UCAN_INVOCATION_POST_BASIC_AUTH } = Config

  const storeBucket = createUcanStore(AWS_REGION, bucketName)

  try {
    await processUcanLogRequest(request, {
      storeBucket,
      streamName,
      basicAuth: UCAN_INVOCATION_POST_BASIC_AUTH,
      kinesisClient
    })
  } catch (/** @type {any} */ error) {
    return {
      statusCode: error.status ?? 500,
      body: Buffer.from(error.message).toString('base64'),
      isBase64Encoded: true,
    }
  }

  return {
    statusCode: 200
  }
}

export const handler = Sentry.AWSLambda.wrapHandler(handlerFn)
