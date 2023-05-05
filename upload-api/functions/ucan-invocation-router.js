import { DID, API } from '@ucanto/core'
import * as Server from '@ucanto/server'
import { Kinesis } from '@aws-sdk/client-kinesis'
import * as Sentry from '@sentry/serverless'

import { createAccessClient } from '../access.js'
import { processAgentMessageArchive } from '../ucan-invocation.js'
import { createCarStore } from '../buckets/car-store.js'
import { createDudewhereStore } from '../buckets/dudewhere-store.js'
import { createInvocationStore } from '../buckets/invocation-store.js'
import { createTaskStore } from '../buckets/task-store.js'
import { createWorkflowStore } from '../buckets/workflow-store.js'
import { createStoreTable } from '../tables/store.js'
import { createUploadTable } from '../tables/upload.js'
import { getServiceSigner } from '../config.js'
import { createUcantoServer } from '../service.js'
import { Config } from '@serverless-stack/node/config/index.js'
import { CAR } from '@ucanto/transport'

Sentry.AWSLambda.init({
  environment: process.env.SST_STAGE,
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 1.0,
})

export { API }
/**
 * @typedef {import('../types').Receipt} Receipt
 * @typedef {import('@ucanto/interface').Block<Receipt>} BlockReceipt
 * @typedef {object} ExecuteCtx
 * @property {import('@ucanto/interface').Signer} signer
 */

const kinesisClient = new Kinesis({})
const AWS_REGION = process.env.AWS_REGION || 'us-west-2'

// Specified in SST environment
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID || ''
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY || ''
const R2_REGION = process.env.R2_REGION || 'auto'
const R2_DUDEWHERE_BUCKET_NAME = process.env.R2_DUDEWHERE_BUCKET_NAME || ''
const R2_ENDPOINT = process.env.R2_ENDPOINT || ``

/**
 * AWS HTTP Gateway handler for POST / with ucan invocation router.
 *
 * We provide responses in Payload format v2.0
 * see: https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-develop-integrations-lambda.html#http-api-develop-integrations-lambda.proxy-format
 *
 * @param {import('aws-lambda').APIGatewayProxyEventV2} request
 */
export async function ucanInvocationRouter(request) {
  const {
    STORE_TABLE_NAME: storeTableName = '',
    STORE_BUCKET_NAME: storeBucketName = '',
    UPLOAD_TABLE_NAME: uploadTableName = '',
    INVOCATION_BUCKET_NAME: invocationBucketName = '',
    TASK_BUCKET_NAME: taskBucketName = '',
    WORKFLOW_BUCKET_NAME: workflowBucketName = '',
    UCAN_LOG_STREAM_NAME: streamName = '',
    // set for testing
    DYNAMO_DB_ENDPOINT: dbEndpoint,
    ACCESS_SERVICE_DID: accessServiceDID = '',
    ACCESS_SERVICE_URL: accessServiceURL = '',
  } = process.env

  if (request.body === undefined) {
    return {
      statusCode: 400,
    }
  }

  const { UPLOAD_API_DID } = process.env
  const { PRIVATE_KEY } = Config
  const serviceSigner = getServiceSigner({ UPLOAD_API_DID, PRIVATE_KEY })

  const invocationBucket = createInvocationStore(
    AWS_REGION,
    invocationBucketName
  )
  const taskBucket = createTaskStore(AWS_REGION, taskBucketName)
  const workflowBucket = createWorkflowStore(AWS_REGION, workflowBucketName)

  const server = await createUcantoServer(serviceSigner, {
    storeTable: createStoreTable(AWS_REGION, storeTableName, {
      endpoint: dbEndpoint,
    }),
    carStoreBucket: createCarStore(AWS_REGION, storeBucketName),
    dudewhereBucket: createDudewhereStore(R2_REGION, R2_DUDEWHERE_BUCKET_NAME, {
      endpoint: R2_ENDPOINT,
      credentials: {
        accessKeyId: R2_ACCESS_KEY_ID,
        secretAccessKey: R2_SECRET_ACCESS_KEY,
      },
    }),
    uploadTable: createUploadTable(AWS_REGION, uploadTableName, {
      endpoint: dbEndpoint,
    }),
    access: createAccessClient(
      serviceSigner,
      DID.parse(accessServiceDID),
      new URL(accessServiceURL)
    ),
  })

  const processingCtx = {
    invocationBucket,
    taskBucket,
    workflowBucket,
    streamName,
    kinesisClient,
  }

  // Process workflow
  // We block until we can log the UCAN invocation if this fails we return a 500
  // to the client. That is because in the future we expect that invocations will
  // be written to a queue first and then processed asynchronously, so if we
  // fail to queue the invocation we should not handle it.
  const incoming = await processAgentMessageArchive(
    {
      headers: /** @type {Record<string, string>} */ (request.headers),
      body: Buffer.from(request.body, 'base64'),
    },
    processingCtx
  )

  // Execute invocations
  const outgoing = await Server.execute(incoming, server)
  const response = CAR.response.encode(outgoing)

  processAgentMessageArchive(response, processingCtx)

  return toLambdaSuccessResponse(response)
}

export const handler = Sentry.AWSLambda.wrapHandler(ucanInvocationRouter)

/**
 * @param {API.HTTPResponse} response
 */
export function toLambdaSuccessResponse({ status = 200, headers, body }) {
  return {
    statusCode: status,
    headers,
    body: Buffer.from(body).toString('base64'),
    isBase64Encoded: true,
  }
}
