import * as Sentry from '@sentry/serverless'
import { invoke, DID } from '@ucanto/core'
import { connect } from '@ucanto/client'
import * as CAR from '@ucanto/transport/car'
import * as HTTP from '@ucanto/transport/http'
import { sha256 } from '@ucanto/core'
import { ed25519 } from '@ucanto/principal'
import { base64pad } from 'multiformats/bases/base64'
import * as UCAN from "@ipld/dag-ucan"

Sentry.AWSLambda.init({
  environment: process.env.SST_STAGE,
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 1.0,
})

/**
 * 
 * @param {Uint8Array} secret
 * @returns 
 */
async function deriveSigner(secret) {
  const { digest } = await sha256.digest(secret)
  return await ed25519.Signer.derive(digest)
}

/**
 * AWS HTTP Gateway handler for POST / with ucan invocation router.
 *
 * We provide responses in Payload format v2.0
 * see: https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-develop-integrations-lambda.html#http-api-develop-integrations-lambda.proxy-format
 *
 * @param {import('aws-lambda').APIGatewayProxyEventV2} request
 */
async function handlerFn(request) {
  try {
    const { UPLOAD_API_DID, ACCESS_SERVICE_URL } = process.env

    if (!UPLOAD_API_DID) {
      return {
        statusCode: 500,
        body: 'UPLOAD_API_DID is not set'
      }
    }

    if (!ACCESS_SERVICE_URL) {
      return {
        statusCode: 500,
        body: 'ACCESS_SERVICE_URL is not set'
      }
    }

    // parse headers
    const authSecretHeader = request.headers['x-auth-secret']
    if (!authSecretHeader) {
      return {
        statusCode: 401,
        body: 'request has no x-auth-secret header'
      }
    }
    const secret = base64pad.baseDecode(authSecretHeader)

    const authorizationHeader = request.headers['authorization']
    if (!authorizationHeader) {
      return {
        statusCode: 401,
        body: 'request has no authorization header'
      }
    }
    if (!authorizationHeader.startsWith('Bearer ')) {
      return {
        statusCode: 401,
        body: 'authorization header must use the Bearer directive'
      }
    }
    const jwt = authorizationHeader.replace('Bearer ', '')
    const delegation = UCAN.parse(jwt)

    // parse body
    const body = request.body
    if (!body) {
      return {
        statusCode: 400,
        body: 'request has no body'
      }
    }

    const jsonBody = JSON.parse(body)

    if (
      (typeof jsonBody.call !== 'string') ||
      (jsonBody.call.split('/').length < 2)
    ) {
      return {
        statusCode: 400,
        body: 'call must be /-separated string like "store/add" or "admin/store/info"'
      }
    }
    const ability = /** @type {import('@ucanto/interface').Ability} */(jsonBody.call)

    if (
      (typeof jsonBody.on !== 'string') ||
      (jsonBody.on.split(':').length < 2)
    ) {
      return {
        statusCode: 400,
        body: 'on must be a URI'
      }
    }
    const resource = /** @type {import('@ucanto/interface').Resource} */(jsonBody.on)

    const invocation = invoke({
      issuer: await deriveSigner(secret),
      audience: DID.parse(UPLOAD_API_DID),
      capability: {
        can: ability,
        with: resource,
        nb: jsonBody.inputs
      },
      proofs: [delegation]
    })
    const receipt = await invocation.execute(connect({
      id: DID.parse(UPLOAD_API_DID),
      codec: CAR.outbound,
      channel: HTTP.open({
        url: new URL(ACCESS_SERVICE_URL),
        method: 'POST'
      })
    }))
    const result = receipt.out
    if (result.ok) {
      return {
        statusCode: 200,
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(result.ok)
      }
    } else {
      return {
        statusCode: 500,
        body: Buffer.from(result.error?.message ?? 'no error message received').toString('base64'),
        isBase64Encoded: true
      }
    }
  } catch (/** @type {any} */ error) {
    console.error(error)
    return {
      statusCode: error.status ?? 500,
      body: Buffer.from(error.message).toString('base64'),
      isBase64Encoded: true,
    }
  }
}

export const handler = Sentry.AWSLambda.wrapHandler(handlerFn)
