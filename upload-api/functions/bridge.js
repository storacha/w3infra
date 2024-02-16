import * as Sentry from '@sentry/serverless'
import { invoke, DID, Delegation } from '@ucanto/core'
import { connect } from '@ucanto/client'
import * as CAR from '@ucanto/transport/car'
import * as HTTP from '@ucanto/transport/http'
import { sha256 } from '@ucanto/core'
import { ed25519 } from '@ucanto/principal'
import { base64url } from 'multiformats/bases/base64'
import * as dagJSON from '@ipld/dag-json'

Sentry.AWSLambda.init({
  environment: process.env.SST_STAGE,
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 1.0,
})

/**
 * 
 * @type {import('../bridge/types').AuthSecretHeaderParser}
 */
async function parseAuthSecretHeader(headerValue) {
  const secret = base64url.decode(headerValue)
  const { digest } = await sha256.digest(secret)
  return { ok: await ed25519.Signer.derive(digest) }
}

/**
 * @type {import('../bridge/types').AuthorizationHeaderParser}
 */
async function parseAuthorizationHeader(headerValue) {
  const result = await Delegation.extract(base64url.decode(headerValue))
  if (result.ok) {
    return { ok: result.ok }
  } else {
    return {
      error: {
        name: 'DelegationParsingError',
        message: 'could not extract delegation from authorization header value',
        cause: result.error
      }
    }
  }
}

/**
 * @type {import('../bridge/types').BodyParser}
 */
async function parseBody(body) {
  const tasks = JSON.parse(body)
  // TODO we should validate that tasks matches the shape of Task[] before casting here!
  return { ok: { tasks: /** @type {import('../bridge/types').Task[]} */(tasks) } }
}

/**
 * @param {import('aws-lambda').APIGatewayProxyEventV2} request 
 */
function parseAwsLambdaRequest(request) {
  const authSecretHeader = request.headers['x-auth-secret']
  const authorizationHeader = request.headers['authorization']
  const body = request.body
  return { authSecretHeader, authorizationHeader, body }
}

/**
 * 
 * @type {import('../bridge/types').TasksExecutor}
 */
export async function invokeAndExecuteTasks(
  issuer, servicePrincipal, serviceURL, tasks, delegation
) {
  const invocations = tasks.map(task => invoke({
    issuer,
    audience: servicePrincipal,
    capability: {
      can: task.do,
      with: task.sub,
      nb: task.args
    },
    proofs: [delegation]
  }))
  /**
   * @type {import('@ucanto/interface').ConnectionView<import('@web3-storage/upload-api').Service>}
   */
  const connection = connect({
    id: servicePrincipal,
    codec: CAR.outbound,
    channel: HTTP.open({
      url: serviceURL,
      method: 'POST'
    })
  })
  // this is an annoying hack to make typescript happy - it wants at LEAST one argument and needs
  // to be assured that that's the case
  const [firstInvocation, ...restOfInvocations] = invocations
  // @ts-ignore multiple issues here
  const receipts = await connection.execute(firstInvocation, ...restOfInvocations)
  // @ts-ignore - TODO this is not great, but TS thinks this should be never - fix before shipping
  return receipts.map(r => r.out)
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

    const { authSecretHeader, authorizationHeader, body } = parseAwsLambdaRequest(request)

    if (!authSecretHeader) {
      return {
        statusCode: 401,
        body: 'request has no x-auth-secret header'
      }
    }

    if (!authorizationHeader) {
      return {
        statusCode: 401,
        body: 'request has no authorization header'
      }
    }

    const parseAuthSecretResult = await parseAuthSecretHeader(authSecretHeader)

    if (parseAuthSecretResult.error) {
      return {
        statusCode: 401,
        body: parseAuthSecretResult.error.message
      }
    }
    const issuer = parseAuthSecretResult.ok

    const parseAuthorizationResult = await parseAuthorizationHeader(authorizationHeader)
    if (parseAuthorizationResult.error) {
      return {
        statusCode: 401,
        body: parseAuthorizationResult.error.message
      }
    }
    const delegation = parseAuthorizationResult.ok

    if (!body) {
      return {
        statusCode: 400,
        body: 'request has no body'
      }
    }

    const parseBodyResult = await parseBody(body)
    if (parseBodyResult.error) {
      return {
        statusCode: 400,
        body: parseBodyResult.error.message
      }
    }
    const tasks = parseBodyResult.ok.tasks
    const results = await invokeAndExecuteTasks(
      issuer,
      DID.parse(UPLOAD_API_DID),
      new URL(ACCESS_SERVICE_URL),
      tasks,
      delegation
    )

    // TODO how do we handle mixed failure?
    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json"
      },
      body: dagJSON.stringify(results)
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
