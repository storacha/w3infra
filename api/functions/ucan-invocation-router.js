import { createSigner } from '../signer.js'
import { createCarStore } from '../buckets/car-store.js'
import { createStoreTable } from '../tables/store.js'
import { createUploadTable } from '../tables/upload.js'
import { getServiceSigner } from '../config.js'
import { createUcantoServer } from '../service/index.js'

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
    DYNAMO_DB_ENDPOINT: dbEndpoint
  } = process.env

  if (request.body === undefined) {
    return {
      statusCode: 400,
    }
  }

  const server = await createUcantoServer({
    serviceSigner: getServiceSigner(),
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
    })
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
