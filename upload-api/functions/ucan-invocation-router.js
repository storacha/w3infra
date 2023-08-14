import { API } from '@ucanto/core'
import * as Server from '@ucanto/server'
import { Kinesis } from '@aws-sdk/client-kinesis'
import * as Sentry from '@sentry/serverless'

import { processAgentMessageArchive } from '../ucan-invocation.js'
import { createCarStore } from '../buckets/car-store.js'
import { createDudewhereStore } from '../buckets/dudewhere-store.js'
import { createInvocationStore } from '../buckets/invocation-store.js'
import { createTaskStore } from '../buckets/task-store.js'
import { createWorkflowStore } from '../buckets/workflow-store.js'
import { createStoreTable } from '../tables/store.js'
import { createUploadTable } from '../tables/upload.js'
import { getServiceSigner, parseServiceDids } from '../config.js'
import { createUcantoServer } from '../service.js'
import { Config } from '@serverless-stack/node/config/index.js'
import { CAR, Legacy, Codec } from '@ucanto/transport'
import { Email } from '../email.js'
import { useProvisionStore } from '../stores/provisions.js'
import { createDelegationsTable } from '../tables/delegations.js'
import { createDelegationsStore } from '../buckets/delegations-store.js'
import { createSubscriptionTable } from '../tables/subscription.js'
import { createConsumerTable } from '../tables/consumer.js'
import { createRateLimitTable } from '../tables/rate-limit.js'

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
 * We define a ucanto codec that will switch encoder / decoder based on the
 * `content-type` and `accept` headers of the request.
 */
const codec = Codec.inbound({
  decoders: {
    // If the `content-type` is set to `application/vnd.ipld.car` use CAR codec.
    [CAR.contentType]: CAR.request,
    // If the `content-type` is set to `application/car` use legacy CAR codec
    // which unlike current CAR codec used CAR roots to signal invocations.
    [Legacy.contentType]: Legacy.request,
  },
  encoders: {
    // Legacy clients did not set `accept` header so catch them using `*/*`
    // and encode responses using legacy (CBOR) encoder.
    '*/*;q=0.1': Legacy.response,
    // Modern clients set `accept` header to `application/vnd.ipld.car` and
    // we encode responses to them in CAR encoding.
    [CAR.contentType]: CAR.response,
  },
})

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
    CONSUMER_TABLE_NAME: consumerTableName = '',
    SUBSCRIPTION_TABLE_NAME: subscriptionTableName = '',
    DELEGATION_TABLE_NAME: delegationTableName = '',
    RATE_LIMIT_TABLE_NAME: rateLimitTableName = '',
    R2_ENDPOINT: r2DelegationBucketEndpoint = '',
    R2_ACCESS_KEY_ID: r2DelegationBucketAccessKeyId = '',
    R2_SECRET_ACCESS_KEY: r2DelegationBucketSecretAccessKey = '',
    R2_DELEGATION_BUCKET_NAME: r2DelegationBucketName = '',
    INVOCATION_BUCKET_NAME: invocationBucketName = '',
    TASK_BUCKET_NAME: taskBucketName = '',
    WORKFLOW_BUCKET_NAME: workflowBucketName = '',
    UCAN_LOG_STREAM_NAME: streamName = '',
    POSTMARK_TOKEN: postmarkToken = '',
    PROVIDERS: providers = '',
    // set for testing
    DYNAMO_DB_ENDPOINT: dbEndpoint,
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
  const delegationBucket = createDelegationsStore(r2DelegationBucketEndpoint, r2DelegationBucketAccessKeyId, r2DelegationBucketSecretAccessKey, r2DelegationBucketName)
  const subscriptionTable = createSubscriptionTable(AWS_REGION, subscriptionTableName, {
    endpoint: dbEndpoint
  });
  const consumerTable = createConsumerTable(AWS_REGION, consumerTableName, {
    endpoint: dbEndpoint
  });
  const rateLimitsStorage = createRateLimitTable(AWS_REGION, rateLimitTableName)
  const provisionsStorage = useProvisionStore(subscriptionTable, consumerTable, parseServiceDids(providers))
  const delegationsStorage = createDelegationsTable(AWS_REGION, delegationTableName, { bucket: delegationBucket, invocationBucket, workflowBucket })

  const server = createUcantoServer(serviceSigner, {
    codec,
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
    signer: serviceSigner,
    // TODO: we should set URL from a different env var, doing this for now to avoid that refactor - tracking in https://github.com/web3-storage/w3infra/issues/209
    url: new URL(accessServiceURL),
    email: new Email({ token: postmarkToken }),
    provisionsStorage,
    delegationsStorage,
    rateLimitsStorage
  })

  const processingCtx = {
    invocationBucket,
    taskBucket,
    workflowBucket,
    streamName,
    kinesisClient,
  }

  const payload = fromLambdaRequest(request)

  const result = server.codec.accept(payload)
  // if we can not select a codec we respond with error.
  if (result.error) {
    return toLambdaResponse({
      status: result.error.status,
      headers: result.error.headers || {},
      body: Buffer.from(result.error.message || ''),
    })
  }

  const { encoder, decoder } = result.ok

  const contentType = payload.headers['content-type']
  // Process workflow
  // We block until we can log the UCAN invocation if this fails we return a 500
  // to the client. That is because in the future we expect that invocations will
  // be written to a queue first and then processed asynchronously, so if we
  // fail to queue the invocation we should not handle it.
  const incoming = await processAgentMessageArchive(
    // If the `content-type` is set to `application/vnd.ipld.car` use CAR codec
    // format is already up to date so we pass payload as is. Otherwise we
    // transform the payload into modern CAR format.
    contentType === CAR.contentType
      ? payload
      : CAR.request.encode(await decoder.decode(payload)),
    processingCtx
  )

  // Execute invocations
  const outgoing = await Server.execute(incoming, server)

  const response = await encoder.encode(outgoing)
  await processAgentMessageArchive(
    // If response is already in CAR format we pass it as is. Otherwise we
    // transform the response into legacy CAR format.
    response.headers['content-type'] === CAR.contentType
      ? response
      : CAR.response.encode(outgoing),
    processingCtx
  )

  return toLambdaResponse(response)
}

export const handler = Sentry.AWSLambda.wrapHandler(ucanInvocationRouter)

/**
 * @param {API.HTTPResponse} response
 */
export function toLambdaResponse({ status = 200, headers, body }) {
  return {
    statusCode: status,
    headers,
    body: Buffer.from(body).toString('base64'),
    isBase64Encoded: true,
  }
}

/**
 * @param {import('aws-lambda').APIGatewayProxyEventV2} request
 */
export const fromLambdaRequest = (request) => ({
  headers: /** @type {Record<string, string>} */ (request.headers),
  body: Buffer.from(request.body || '', 'base64'),
})
