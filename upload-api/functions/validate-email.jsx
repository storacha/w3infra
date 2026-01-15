import * as Sentry from '@sentry/serverless'
import { authorize } from '@storacha/upload-api/validate'
import { Config } from 'sst/node/config'
import { mustGetConfig } from '../../lib/env.js'
import { getServiceSigner, parseServiceDids } from '../config.js'
import { Email } from '../email.js'
import { createDelegationsTable } from '../tables/delegations.js'
import {
  createDelegationsStore,
  createR2DelegationsStore,
} from '../buckets/delegations-store.js'
import { createSubscriptionTable } from '../tables/subscription.js'
import { createConsumerTable } from '../tables/consumer.js'
import { createRevocationsTable } from '../stores/revocations.js'
import { createReferralStore } from '../stores/referrals.js'
import * as AgentStore from '../stores/agent.js'
import { useProvisionStore } from '../stores/provisions.js'
// @ts-expect-error
// eslint-disable-next-line import/extensions
import * as htmlStoracha from '../html-storacha'
// @ts-expect-error
// eslint-disable-next-line import/extensions
import * as htmlW3s from '../html-w3s'
import { createRateLimitTable } from '../tables/rate-limit.js'
import { createCustomerStore } from '../../billing/tables/customer.js'
import { createSpaceDiffStore } from '../../billing/tables/space-diff.js'
import { createSpaceSnapshotStore } from '../../billing/tables/space-snapshot.js'
import { createEgressTrafficEventStore } from '../../billing/tables/egress-traffic.js'
import { createEgressTrafficQueue } from '../../billing/queues/egress-traffic.js'
import { useSubscriptionsStore } from '../stores/subscriptions.js'
import { useUsageStore } from '../stores/usage.js'
import { productInfo } from '../../billing/lib/product-info.js'
import { wrapLambdaHandler } from '../otel.js'

const html =
  process.env.HOSTED_ZONE === 'up.web3.storage' ? htmlW3s : htmlStoracha

Sentry.AWSLambda.init({
  environment: process.env.SST_STAGE,
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 0,
})

/**
 * @param {Response & { getStringBody: () => string }} response
 */
export function toLambdaResponse(response) {
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
    isBase64Encoded: true,
  }
}

/**
 * AWS HTTP Gateway handler for GET /validate-email
 *
 * @param {import('aws-lambda').APIGatewayProxyEventV2} request
 */
export async function validateEmailGet(request) {
  if (!request.queryStringParameters?.ucan) {
    return toLambdaResponse(
      new html.HtmlResponse(
        <html.ValidateEmailError msg={'Missing delegation in the URL.'} />
      )
    )
  }

  return toLambdaResponse(
    new html.HtmlResponse(<html.PendingValidateEmail autoApprove={true} />)
  )
}

export const preValidateEmail = Sentry.AWSLambda.wrapHandler(
  wrapLambdaHandler('pre-validate-email', validateEmailGet)
)

function createAuthorizeContext() {
  const {
    ACCESS_SERVICE_URL = '',
    AWS_REGION = '',
    DELEGATION_BUCKET_NAME = '',
    DELEGATION_TABLE_NAME = '',
    REVOCATION_TABLE_NAME = '',
    RATE_LIMIT_TABLE_NAME = '',
    AGENT_INDEX_TABLE_NAME = '',
    AGENT_INDEX_BUCKET_NAME = '',
    AGENT_MESSAGE_BUCKET_NAME = '',
    SUBSCRIPTION_TABLE_NAME = '',
    CONSUMER_TABLE_NAME = '',
    CUSTOMER_TABLE_NAME = '',
    UPLOAD_API_DID = '',
    REFERRALS_ENDPOINT = '',
    UCAN_LOG_STREAM_NAME = '',
    SPACE_DIFF_TABLE_NAME = '',
    SPACE_SNAPSHOT_TABLE_NAME = '',
    EGRESS_TRAFFIC_TABLE_NAME = '',
    EGRESS_TRAFFIC_QUEUE_URL = '',
    SST_STAGE = '',
    // set for testing
    DYNAMO_DB_ENDPOINT: dbEndpoint,
  } = process.env
  // Config parameters loaded from SST Config to reduce Lambda env var size
  const PRIVATE_KEY = Config.PRIVATE_KEY
  const POSTMARK_TOKEN = mustGetConfig('POSTMARK_TOKEN')
  const PROVIDERS = mustGetConfig('PROVIDERS')
  const R2_ENDPOINT = mustGetConfig('R2_ENDPOINT')
  const R2_ACCESS_KEY_ID = mustGetConfig('R2_ACCESS_KEY_ID')
  const R2_SECRET_ACCESS_KEY = mustGetConfig('R2_SECRET_ACCESS_KEY')
  const R2_DELEGATION_BUCKET = mustGetConfig('R2_DELEGATION_BUCKET')

  const delegationBucket = R2_DELEGATION_BUCKET
    ? createR2DelegationsStore(
        R2_ENDPOINT,
        R2_ACCESS_KEY_ID,
        R2_SECRET_ACCESS_KEY,
        R2_DELEGATION_BUCKET
      )
    : createDelegationsStore(AWS_REGION, DELEGATION_BUCKET_NAME)

  const subscriptionTable = createSubscriptionTable(
    AWS_REGION,
    SUBSCRIPTION_TABLE_NAME,
    {
      endpoint: dbEndpoint,
    }
  )
  const consumerTable = createConsumerTable(AWS_REGION, CONSUMER_TABLE_NAME, {
    endpoint: dbEndpoint,
  })
  const customerStore = createCustomerStore(
    { region: AWS_REGION },
    { tableName: CUSTOMER_TABLE_NAME }
  )
  const referralStore = createReferralStore({ endpoint: REFERRALS_ENDPOINT })

  const agentStore = AgentStore.open({
    store: {
      dynamoDBConnection: {
        address: {
          region: AWS_REGION,
        },
      },
      s3Connection: {
        address: {
          region: AWS_REGION,
        },
      },
      region: AWS_REGION,
      buckets: {
        message: { name: AGENT_MESSAGE_BUCKET_NAME },
        index: { name: AGENT_INDEX_BUCKET_NAME },
      },
      tables: {
        index: { name: AGENT_INDEX_TABLE_NAME },
      },
    },
    stream: {
      connection: { address: {} },
      name: UCAN_LOG_STREAM_NAME,
    },
  })

  const spaceDiffStore = createSpaceDiffStore(
    { region: AWS_REGION },
    { tableName: SPACE_DIFF_TABLE_NAME }
  )
  const spaceSnapshotStore = createSpaceSnapshotStore(
    { region: AWS_REGION },
    { tableName: SPACE_SNAPSHOT_TABLE_NAME }
  )
  const egressTrafficStore = createEgressTrafficEventStore(
    { region: AWS_REGION },
    { tableName: EGRESS_TRAFFIC_TABLE_NAME }
  )
  const egressTrafficQueue = createEgressTrafficQueue(
    { region: AWS_REGION },
    { url: new URL(EGRESS_TRAFFIC_QUEUE_URL) }
  )

  const usageStorage = useUsageStore({
    spaceDiffStore,
    spaceSnapshotStore,
    egressTrafficStore,
    egressTrafficQueue,
  })

  return {
    // TODO: we should set URL from a different env var, doing this for now to avoid that refactor
    url: new URL(ACCESS_SERVICE_URL),
    email: new Email({
      token: POSTMARK_TOKEN,
      environment: SST_STAGE === 'prod' ? undefined : SST_STAGE,
    }),
    signer: getServiceSigner({ did: UPLOAD_API_DID, privateKey: PRIVATE_KEY }),
    delegationsStorage: createDelegationsTable(
      AWS_REGION,
      DELEGATION_TABLE_NAME,
      { bucket: delegationBucket }
    ),
    revocationsStorage: createRevocationsTable(
      AWS_REGION,
      REVOCATION_TABLE_NAME
    ),
    provisionsStorage: useProvisionStore(
      subscriptionTable,
      consumerTable,
      customerStore,
      parseServiceDids(PROVIDERS),
      productInfo
    ),
    rateLimitsStorage: createRateLimitTable(AWS_REGION, RATE_LIMIT_TABLE_NAME),
    customerStore,
    referralStore,
    agentStore,
    usageStorage,
    subscriptionsStorage: useSubscriptionsStore({ consumerTable }),
  }
}

/**
 * AWS HTTP Gateway handler for POST /validate-email
 *
 * @param {import('aws-lambda').APIGatewayProxyEventV2} request
 */
export async function validateEmailPost(request) {
  const encodedUcan = request.queryStringParameters?.ucan
  if (!encodedUcan) {
    return toLambdaResponse(
      new html.HtmlResponse(
        <html.ValidateEmailError msg={'Missing delegation in the URL.'} />
      )
    )
  }
  const context = createAuthorizeContext()

  const authorizeResult = await authorize(encodedUcan, context)

  if (authorizeResult.error) {
    console.error(authorizeResult.error)
    return toLambdaResponse(
      new html.HtmlResponse(
        (
          <html.ValidateEmailError
            msg={`Oops, something went wrong: ${authorizeResult.error.message}`}
          />
        ),
        { status: 500 }
      )
    )
  }

  const { email, audience, ucan } = authorizeResult.ok

  return toLambdaResponse(
    new html.HtmlResponse(
      <html.ValidateEmail email={email} audience={audience} ucan={ucan} />
    )
  )
}

export const validateEmail = Sentry.AWSLambda.wrapHandler(
  wrapLambdaHandler('validate-email', validateEmailPost)
)
