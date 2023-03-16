import * as Sentry from '@sentry/serverless'

import { createUcantoServer } from '../service/index.js'

/**
 * AWS HTTP Gateway handler for POST / with ucan invocation router.
 *
 * We provide responses in Payload format v2.0
 * see: https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-develop-integrations-lambda.html#http-api-develop-integrations-lambda.proxy-format
 *
 * @param {import('aws-lambda').APIGatewayProxyEventV2} request
 */
async function ucanInvocationRouter(request) {

}

export const handler = Sentry.AWSLambda.wrapHandler(ucanInvocationRouter)

/**
 * @param {import('@ucanto/server').HTTPResponse<never>} response
 */
function toLambdaSuccessResponse(response) {
  return {
    statusCode: 200,
    headers: response.headers,
    body: Buffer.from(response.body).toString('base64'),
    isBase64Encoded: true,
  }
}
