import { DID } from '@ucanto/core'
import * as Server from '@ucanto/server'
import * as CAR from '@ucanto/transport/car'
import * as CBOR from '@ucanto/transport/cbor'
import { Kinesis } from '@aws-sdk/client-kinesis'
import * as Sentry from '@sentry/serverless'

import { createAccessClient } from '../access.js'
import {
  processWorkflow,
  processTaskReceipt
} from '../ucan-invocation.js'
import { createCarStore } from '../buckets/car-store.js'
import { createDudewhereStore } from '../buckets/dudewhere-store.js'
import { createUcanStore } from '../buckets/ucan-store.js'
import { createStoreTable } from '../tables/store.js'
import { createUploadTable } from '../tables/upload.js'
import { getServiceSigner } from '../config.js'
import { createUcantoServer } from '../service.js'
import { Config } from '@serverless-stack/node/config/index.js'

Sentry.AWSLambda.init({
  environment: process.env.SST_STAGE,
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 1.0,
})

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
async function ucanInvocationRouter(request) {
  const {
    STORE_TABLE_NAME: storeTableName = '',
    STORE_BUCKET_NAME: storeBucketName = '',
    UPLOAD_TABLE_NAME: uploadTableName = '',
    UCAN_BUCKET_NAME: ucanBucketName = '',
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
  const storeBucket = createUcanStore(AWS_REGION, ucanBucketName)

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
    storeBucket,
    streamName,
    kinesisClient
  }

  // Decode body and its invocations
  const body = Buffer.from(request.body, 'base64')
  const invocations = await CAR.decode({
    body,
    // @ts-expect-error - type is Record<string, string|string[]|undefined>
    headers: request.headers,
  })

  // Process workflow
  // We block until we can log the UCAN invocation if this fails we return a 500
  // to the client. That is because in the future we expect that invocations will
  // be written to a queue first and then processed asynchronously, so if we
  // fail to queue the invocation we should not handle it.
  await processWorkflow(body, processingCtx)

  // Execute invocations
  const results = await Promise.all(
    invocations.map((invocation) => execute(invocation, server, {
      signer: serviceSigner
    }))
  )

  const forks = []
  const out = []

  for (const receipt of results) {
    out.push(receipt.data.out.error || receipt.data.out.ok)
    forks.push(processTaskReceipt(receipt.bytes, processingCtx))
  }

  await Promise.all(forks)
  const response = await CBOR.encode(out)

  return toLambdaSuccessResponse(response)
}

export const handler = Sentry.AWSLambda.wrapHandler(ucanInvocationRouter)

/**
 * @param {import('@ucanto/server').HTTPResponse<any>} response
 */
function toLambdaSuccessResponse(response) {
  return {
    statusCode: 200,
    headers: response.headers,
    body: Buffer.from(response.body).toString('base64'),
    isBase64Encoded: true,
  }
}

/**
 *
 * @param {Server.Invocation} invocation
 * @param {Server.ServerView<*>} server
 * @param {ExecuteCtx} ctx
 * @returns {Promise<Required<BlockReceipt>>}
 */
const execute = async (invocation, server, ctx) => {
  /** @type {[Server.Result<*, Server.API.Failure>]} */
  const [result] = await Server.execute([invocation], server)
  const out = result?.error ? { error: result } : { ok: result }

  // Create a receipt payload for the invocation conforming to the spec
  // @see https://github.com/ucan-wg/invocation/#8-receipt
  const payload = {
    ran: invocation.cid,
    out,
    fx: { fork: [] },
    meta: {},
    iss: ctx.signer.did(),
    prf: [],
  }

  // create a receipt by signing the payload with a server key
  const receipt = {
    ...payload,
    s: await ctx.signer.sign(CBOR.codec.encode(payload)),
  }

  return {
    data: receipt,
    ...(await CBOR.codec.write(receipt)),
  }
}
