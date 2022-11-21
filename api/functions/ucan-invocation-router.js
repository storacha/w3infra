import * as Server from '@ucanto/server'
import * as CAR from '@ucanto/transport/car'
import * as CBOR from '@ucanto/transport/cbor'
import { DID } from '@ucanto/core'

import getServiceDid from '../authority.js'
import { createAccessClient } from '../access.js'
import { createSigner } from '../signer.js'
import { createCarStore } from '../buckets/car-store.js'
import { createStoreTable } from '../tables/store.js'
import { createUploadTable } from '../tables/upload.js'
import { createServiceRouter } from '../service/index.js'

const AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID || ''
const AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY || ''
const AWS_SESSION_TOKEN = process.env.AWS_SESSION_TOKEN || ''
const AWS_REGION = process.env.AWS_REGION || 'us-west-2'

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

  const serviceSigner = await getServiceDid()
  const server = await createUcantoServer(serviceSigner, {
    storeTable: createStoreTable(AWS_REGION, storeTableName, {
      endpoint: dbEndpoint
    }),
    carStoreBucket: createCarStore(AWS_REGION, storeBucketName),
    uploadTable: createUploadTable(AWS_REGION, uploadTableName, {
      endpoint: dbEndpoint
    }),
    signer: createSigner({
      region: AWS_REGION,
      secretAccessKey: AWS_SECRET_ACCESS_KEY,
      accessKeyId: AWS_ACCESS_KEY_ID,
      sessionToken: AWS_SESSION_TOKEN,
      bucket: storeBucketName,
    }),
    access: createAccessClient(serviceSigner, DID.parse(accessServiceDID), new URL(accessServiceURL))
  })
  const response = await server.request({
    // @ts-expect-error - type is Record<string, string|string[]|undefined>
    headers: request.headers,
    body: Buffer.from(request.body, 'base64'),
  })

  return toLambdaSuccessResponse(response)
}

export const handler = ucanInvocationRouter

/**
 * @param {import('@ipld/dag-ucan').Principal} servicePrincipal
 * @param {import('../service/types').UcantoServerContext} context
 */
export async function createUcantoServer (servicePrincipal, context) {
  const server = Server.create({
    id: servicePrincipal,
    encoder: CBOR,
    decoder: CAR,
    service: createServiceRouter(context),
    catch: (/** @type {string | Error} */ err) => {
      // TODO: We need sentry to log stuff
      console.log('reporting error to sentry', err)
    },
  })

  return server
}

/**
 * @param {Server.HTTPResponse<never>} response
 */
function toLambdaSuccessResponse (response) {
  return {
    statusCode: 200,
    headers: response.headers,
    body: Buffer.from(response.body).toString('base64'),
    isBase64Encoded: true,
  }
}
