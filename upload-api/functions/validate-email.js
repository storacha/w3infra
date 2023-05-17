import * as Sentry from '@sentry/serverless'
import { authorize } from '@web3-storage/upload-api/validate'
import { getServiceSigner } from '../config.js'
import { Email } from '../email.js'
import { createProvisionsTable } from '../tables/provisions.js'
import { createDelegationsTable } from '../tables/delegations.js'
import { createDelegationsStore } from '../buckets/delegations-store.js'
import {
  HtmlResponse,
  ValidateEmail,
  ValidateEmailError,
  PendingValidateEmail,
} from '../html.js'

Sentry.AWSLambda.init({
  environment: process.env.SST_STAGE,
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 1.0,
})

/**
 * AWS HTTP Gateway handler for GET /validate-email
 *
 * @param {import('aws-lambda').APIGatewayProxyEventV2} request
 */
export async function validateEmailGet (request) {
  if (!request.queryStringParameters?.ucan) {
    return new HtmlResponse(
      <ValidateEmailError msg={'Missing delegation in the URL.'} />
    )
  }

  return new HtmlResponse(<PendingValidateEmail autoApprove={true} />)
}

export const preValidateEmail = Sentry.AWSLambda.wrapHandler(validateEmailGet)

function createAuthorizeContext () {
  const {
    ACCESS_SERVICE_URL = '',
    ACCESS_SERVICE_DID = '',
    AWS_REGION = '',
    DELEGATION_TABLE_NAME = '',
    DELEGATION_BUCKET_NAME = '',
    POSTMARK_TOKEN = '',
    PRIVATE_KEY = '',
    PROVISION_TABLE_NAME = '',
    UPLOAD_API_DID = ''
  } = process.env
  const delegationBucket = createDelegationsStore(AWS_REGION, DELEGATION_BUCKET_NAME)
  return {
    // TODO: we should set URL from a different env var, doing this for now to avoid that refactor
    url: new URL(ACCESS_SERVICE_URL),
    email: new Email({ token: POSTMARK_TOKEN }),
    signer: getServiceSigner({ UPLOAD_API_DID, PRIVATE_KEY }),
    delegationsStorage: createDelegationsTable(AWS_REGION, DELEGATION_TABLE_NAME, delegationBucket),
    provisionsStorage: createProvisionsTable(AWS_REGION, PROVISION_TABLE_NAME, [
      /** @type {import('@web3-storage/upload-api').ServiceDID} */
      (ACCESS_SERVICE_DID)
    ]),
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
    return new HtmlResponse(
      <ValidateEmailError msg={'Missing delegation in the URL.'} />
    )
  }

  const authorizeResult = await authorize(encodedUcan, createAuthorizeContext())
  if (authorizeResult.error) {
    return new HtmlResponse(
      <ValidateEmailError msg={`Oops something went wrong: ${authorizeResult.error.message}`} />,
      { status: 500 }
    )
  }

  const { email, audience, ucan } = authorizeResult.ok

  return new HtmlResponse(
    <ValidateEmail
      email={email}
      audience={audience}
      ucan={ucan}
    />
  )
}

export const validateEmail = Sentry.AWSLambda.wrapHandler(validateEmailPost)
