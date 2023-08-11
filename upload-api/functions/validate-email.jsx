import * as Sentry from '@sentry/serverless'
import { authorize } from '@web3-storage/upload-api/validate'
import { Config } from '@serverless-stack/node/config/index.js'
import { getServiceSigner } from '../config.js'
import { Email } from '../email.js'
import { createDelegationsTable } from '../tables/delegations.js'
import { createDelegationsStore } from '../buckets/delegations-store.js'
import { createInvocationStore } from '../buckets/invocation-store.js'
import { createWorkflowStore } from '../buckets/workflow-store.js'
import { createSubscriptionTable } from '../tables/subscription.js'
import { createConsumerTable } from '../tables/consumer.js'

import { useProvisionStore } from '../stores/provisions.js'
import {
  HtmlResponse,
  ValidateEmail,
  ValidateEmailError,
  PendingValidateEmail,
} from '../html.jsx'
import { createRateLimitTable } from '../tables/rate-limit.js'

Sentry.AWSLambda.init({
  environment: process.env.SST_STAGE,
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 1.0,
})

/**
 * @param {HtmlResponse} response
 */
export function toLambdaResponse (response) {
  const { status = 200, headers: responseHeaders, body } = response
  // translate headers from Response format to Lambda format
  /** @type {Record<string, string>} */
  const headers = {}
  responseHeaders.forEach((value, key) => {
    headers[key] = value
  })
  return {
    statusCode: status,
    headers,
    body: body && Buffer.from(response.getStringBody()).toString('base64'),
    isBase64Encoded: true
  }
}

/**
 * AWS HTTP Gateway handler for GET /validate-email
 *
 * @param {import('aws-lambda').APIGatewayProxyEventV2} request
 */
export async function validateEmailGet (request) {
  if (!request.queryStringParameters?.ucan) {
    return toLambdaResponse(new HtmlResponse(
      <ValidateEmailError msg={'Missing delegation in the URL.'} />
    ))
  }

  return toLambdaResponse(new HtmlResponse(<PendingValidateEmail autoApprove={true} />))
}

export const preValidateEmail = Sentry.AWSLambda.wrapHandler(validateEmailGet)

function createAuthorizeContext () {
  const {
    ACCESS_SERVICE_URL = '',
    ACCESS_SERVICE_DID = '',
    AWS_REGION = '',
    DELEGATION_TABLE_NAME = '',
    RATE_LIMIT_TABLE_NAME = '',
    R2_ENDPOINT = '',
    R2_ACCESS_KEY_ID = '',
    R2_SECRET_ACCESS_KEY = '',
    R2_DELEGATION_BUCKET_NAME = '',
    INVOCATION_BUCKET_NAME = '',
    WORKFLOW_BUCKET_NAME = '',
    POSTMARK_TOKEN = '',
    SUBSCRIPTION_TABLE_NAME = '',
    CONSUMER_TABLE_NAME = '',
    UPLOAD_API_DID = '',
    // set for testing
    DYNAMO_DB_ENDPOINT: dbEndpoint,
  } = process.env
  const { PRIVATE_KEY } = Config
  const invocationBucket = createInvocationStore(
    AWS_REGION,
    INVOCATION_BUCKET_NAME
  )
  const workflowBucket = createWorkflowStore(AWS_REGION, WORKFLOW_BUCKET_NAME)
  const delegationBucket = createDelegationsStore(R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_DELEGATION_BUCKET_NAME)
  const subscriptionTable = createSubscriptionTable(AWS_REGION, SUBSCRIPTION_TABLE_NAME, {
    endpoint: dbEndpoint
  });
  const consumerTable = createConsumerTable(AWS_REGION, CONSUMER_TABLE_NAME, {
    endpoint: dbEndpoint
  });
  return {
    // TODO: we should set URL from a different env var, doing this for now to avoid that refactor
    url: new URL(ACCESS_SERVICE_URL),
    email: new Email({ token: POSTMARK_TOKEN }),
    signer: getServiceSigner({ UPLOAD_API_DID, PRIVATE_KEY }),
    delegationsStorage: createDelegationsTable(AWS_REGION, DELEGATION_TABLE_NAME, { bucket: delegationBucket, invocationBucket, workflowBucket }),
    provisionsStorage: useProvisionStore(subscriptionTable, consumerTable, [
      /** @type {import('@web3-storage/upload-api').ServiceDID} */
      (ACCESS_SERVICE_DID)
    ]),
    rateLimitsStorage: createRateLimitTable(AWS_REGION, RATE_LIMIT_TABLE_NAME)
  }
}

/**
 * AWS HTTP Gateway handler for POST /validate-email
 *
 * @param {import('aws-lambda').APIGatewayProxyEventV2} request
 */
export async function validateEmailPost (request) {
  const encodedUcan = request.queryStringParameters?.ucan
  if (!encodedUcan) {
    return toLambdaResponse(new HtmlResponse(
      <ValidateEmailError msg={'Missing delegation in the URL.'} />
    ))
  }
  const authorizeResult = await authorize(encodedUcan, createAuthorizeContext())
  if (authorizeResult.error) {
    console.error(authorizeResult.error)
    return toLambdaResponse(new HtmlResponse(
      <ValidateEmailError msg={`Oops something went wrong: ${authorizeResult.error.message}`} />,
      { status: 500 }
    ))
  }

  const { email, audience, ucan } = authorizeResult.ok

  return toLambdaResponse(new HtmlResponse(
    <ValidateEmail
      email={email}
      audience={audience}
      ucan={ucan}
    />
  ))
}

export const validateEmail = Sentry.AWSLambda.wrapHandler(validateEmailPost)
