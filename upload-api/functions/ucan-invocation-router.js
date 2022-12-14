import { DID } from '@ucanto/core'
import { Kinesis } from '@aws-sdk/client-kinesis'
import * as Sentry from '@sentry/serverless'
import { fromString as uint8arrayFromString } from 'uint8arrays/from-string'

import { createAccessClient } from '../access.js'
import { parseUcanInvocationRequest, persistUcanInvocation } from '../ucan-invocation.js'
import { createCarStore } from '../buckets/car-store.js'
import { createDudewhereStore } from '../buckets/dudewhere-store.js'
import { createUcanStore } from '../buckets/ucan-store.js'
import { createStoreTable } from '../tables/store.js'
import { createUploadTable } from '../tables/upload.js'
import { getServicePrincipal, getServiceSigner } from '../config.js'
import { createUcantoServer } from '../service/index.js'
import { Config } from '@serverless-stack/node/config/index.js'

Sentry.AWSLambda.init({
  environment: process.env.SST_STAGE,
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 1.0,
})

const kinesisClient = new Kinesis({})
const AWS_REGION = process.env.AWS_REGION || 'us-west-2'

// Specified in SST environment
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID || ''
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY || ''
const R2_REGION = process.env.R2_REGION || 'auto'
const R2_DUDEWHERE_BUCKET_NAME =
  process.env.R2_DUDEWHERE_BUCKET_NAME || ''
const R2_ENDPOINT = process.env.R2_ENDPOINT || ``

/**
 * AWS HTTP Gateway handler for POST / with ucan invocation router.
 * 
 * We provide responses in Payload format v2.0
 * see: https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-develop-integrations-lambda.html#http-api-develop-integrations-lambda.proxy-format
 *
 * @param {import('aws-lambda').APIGatewayProxyEventV2} request 
 */
async function ucanInvocationRouter (request) {
  const {
    STORE_TABLE_NAME: storeTableName = '',
    STORE_BUCKET_NAME: storeBucketName = '',
    UPLOAD_TABLE_NAME: uploadTableName = '',
    UCAN_BUCKET_NAME: ucanBucketName = '',
    UCAN_LOG_STREAM_NAME: ucanLogStreamName = '',
    // set for testing
    DYNAMO_DB_ENDPOINT: dbEndpoint,
    ACCESS_SERVICE_DID: accessServiceDID = '',
    ACCESS_SERVICE_URL: accessServiceURL = ''
  } = process.env

  if (request.body === undefined) {
    return {
      statusCode: 400,
    }
  }

  const { UPLOAD_API_DID } = process.env;
  const { PRIVATE_KEY } = Config
  const servicePrincipal = getServicePrincipal({ UPLOAD_API_DID, PRIVATE_KEY })
  const serviceSigner = getServiceSigner({ PRIVATE_KEY })
  const ucanStoreBucket = createUcanStore(AWS_REGION, ucanBucketName)

  const server = await createUcantoServer(servicePrincipal, {
    storeTable: createStoreTable(AWS_REGION, storeTableName, {
      endpoint: dbEndpoint
    }),
    carStoreBucket: createCarStore(AWS_REGION, storeBucketName),
    dudewhereBucket: createDudewhereStore(
      R2_REGION,
      R2_DUDEWHERE_BUCKET_NAME,
      {
        endpoint: R2_ENDPOINT,
        credentials: {
          accessKeyId: R2_ACCESS_KEY_ID,
          secretAccessKey: R2_SECRET_ACCESS_KEY,
        },
      }
    ),
    uploadTable: createUploadTable(AWS_REGION, uploadTableName, {
      endpoint: dbEndpoint
    }),
    access: createAccessClient(serviceSigner, DID.parse(accessServiceDID), new URL(accessServiceURL))
  })
  const response = await server.request({
    // @ts-expect-error - type is Record<string, string|string[]|undefined>
    headers: request.headers,
    body: Buffer.from(request.body, 'base64'),
  })

  const ucanInvocation = await parseUcanInvocationRequest(request)

  // persist successful invocation handled
  await persistUcanInvocation(ucanInvocation, ucanStoreBucket)

  // Put invocation to UCAN stream
  await kinesisClient.putRecord({
    Data: uint8arrayFromString(JSON.stringify({
      carCid: ucanInvocation.carCid,
      value: ucanInvocation.value,
      ts: Date.now()
    })),
    // https://docs.aws.amazon.com/streams/latest/dev/key-concepts.html
    // A partition key is used to group data by shard within a stream.
    // It is required, and now we are starting with one shard. We need to study best partition key
    PartitionKey: 'key',
    StreamName: ucanLogStreamName,
  })

  return toLambdaSuccessResponse(response)
}

export const handler = Sentry.AWSLambda.wrapHandler(ucanInvocationRouter)

/**
 * @param {import('@ucanto/server').HTTPResponse<never>} response
 */
function toLambdaSuccessResponse (response) {
  return {
    statusCode: 200,
    headers: response.headers,
    body: Buffer.from(response.body).toString('base64'),
    isBase64Encoded: true,
  }
}
