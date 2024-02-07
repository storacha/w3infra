import * as Sentry from '@sentry/serverless'
import { invoke, DID } from '@ucanto/core'
import { connect } from '@ucanto/client'
import * as CAR from '@ucanto/transport/car'
import * as HTTP from '@ucanto/transport/http'
import { sha256 } from '@ucanto/core'
import * as Delegation from '@ucanto/core/delegation'
import { ed25519 } from '@ucanto/principal'
import { base64pad } from 'multiformats/bases/base64'

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

    const authorizationHeader = request.headers['authorization']
    if (!authorizationHeader) {
      return {
        statusCode: 401,
        body: 'request has no authorization header'
      }
    }
    const secret = base64pad.decode(authorizationHeader)

    const body = request.body

    if (!body) {
      return {
        statusCode: 400,
        body: 'request has no body'
      }
    }

    const jsonBody = JSON.parse(body)

    if (
      (typeof jsonBody.ability !== 'string') ||
      (jsonBody.ability.split('/').length < 2)
    ) {
      return {
        statusCode: 400,
        body: 'ability must be /-separated string like "store/add" or "admin/store/info"'
      }
    }
    const ability = /** @type {import('@ucanto/interface').Ability} */(jsonBody.ability)

    if (
      (typeof jsonBody.resource !== 'string') ||
      (jsonBody.resource.split(':').length < 2)
    ) {
      return {
        statusCode: 400,
        body: 'resource must be a URI'
      }
    }
    const resource = /** @type {import('@ucanto/interface').Resource} */(jsonBody.resource)

    if (typeof jsonBody.proof !== 'string') {
      return {
        statusCode: 400,
        body: 'proof must be a base64pad multibase encoding of a Delegation archive'
      }
    }
    const delegationResult = await Delegation.extract(base64pad.decode(jsonBody.proof))
    if (delegationResult.error) {
      return {
        statusCode: 400,
        body: 'error'
      }
    }
    const delegation = delegationResult.ok

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
        body: result.ok
      }
    } else {
      return {
        statusCode: 500,
        body: Buffer.from(result.error?.message ?? 'no error message received').toString('base64'),
        isBase64Encoded: true
      }
    }
  } catch (/** @type {any} */ error) {
    return {
      statusCode: error.status ?? 500,
      body: Buffer.from(error.message).toString('base64'),
      isBase64Encoded: true,
    }
  }
}

export const handler = Sentry.AWSLambda.wrapHandler(handlerFn)
