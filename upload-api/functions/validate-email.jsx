import * as Sentry from '@sentry/serverless'
import { authorize } from '@storacha/upload-api/validate'
import { Config } from 'sst/node/config'
import * as DidMailto from '@storacha/did-mailto'
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
    R2_ENDPOINT = '',
    R2_ACCESS_KEY_ID = '',
    R2_SECRET_ACCESS_KEY = '',
    R2_DELEGATION_BUCKET_NAME = '',
    AGENT_INDEX_BUCKET_NAME = '',
    AGENT_MESSAGE_BUCKET_NAME = '',
    POSTMARK_TOKEN = '',
    SUBSCRIPTION_TABLE_NAME = '',
    CONSUMER_TABLE_NAME = '',
    CUSTOMER_TABLE_NAME = '',
    UPLOAD_API_DID = '',
    PROVIDERS = '',
    STRIPE_PRICING_TABLE_ID = '',
    STRIPE_FREE_TRIAL_PRICING_TABLE_ID = '',
    STRIPE_PUBLISHABLE_KEY = '',
    REFERRALS_ENDPOINT = '',
    UCAN_LOG_STREAM_NAME = '',
    SPACE_DIFF_TABLE_NAME = '',
    SPACE_SNAPSHOT_TABLE_NAME = '',
    EGRESS_TRAFFIC_QUEUE_URL = '',
    SST_STAGE = '',
    // set for testing
    DYNAMO_DB_ENDPOINT: dbEndpoint,
  } = process.env
  const { PRIVATE_KEY } = Config

  const delegationBucket = R2_DELEGATION_BUCKET_NAME
    ? createR2DelegationsStore(
        R2_ENDPOINT,
        R2_ACCESS_KEY_ID,
        R2_SECRET_ACCESS_KEY,
        R2_DELEGATION_BUCKET_NAME
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
      connection: {
        address: {
          region: AWS_REGION,
        },
      },
      region: AWS_REGION,
      buckets: {
        message: { name: AGENT_MESSAGE_BUCKET_NAME },
        index: { name: AGENT_INDEX_BUCKET_NAME },
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
  const egressTrafficQueue = createEgressTrafficQueue(
    { region: AWS_REGION },
    { url: new URL(EGRESS_TRAFFIC_QUEUE_URL) }
  )

  const usageStorage = useUsageStore({
    spaceDiffStore,
    spaceSnapshotStore,
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
    stripePricingTableId: STRIPE_PRICING_TABLE_ID,
    stripeFreeTrialPricingTableId: STRIPE_FREE_TRIAL_PRICING_TABLE_ID,
    stripePublishableKey: STRIPE_PUBLISHABLE_KEY,
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

  const { email, audience, ucan, facts } = authorizeResult.ok

  const planCheckResult = await context.customerStore.get({
    customer: DidMailto.fromEmail(email),
  })
  let isReferred = false
  try {
    // if we can find a referral code for this user, offer them a free trial
    if ((await context.referralStore.getReferredBy(email)).refcode) {
      isReferred = true
    }
  } catch (e) {
    // if we fail here, log the error and move on
    console.warn(
      'encountered an error checking the referrals service, please see the error logs for more information'
    )
    console.error(e)
  }
  let stripePricingTableId
  let stripePublishableKey

  // if one of the facts have an 'app' entry, return it
  // if there are more than one this will potentially be nondeterministic
  const appName = facts.find((fact) => fact.appName)?.appName
  if (!planCheckResult.ok?.product) {
    stripePublishableKey = context.stripePublishableKey
    // TODO: use AppName.{BskyBackups,TGMiniapp,Console} from @storacha/client/types once we upgrade that dependency
    // I'd have done it now but upgrading causes linting issues and I want to save
    // that rabbithole for later
    if (
      appName === 'bsky-backups' ||
      appName === 'tg-miniapp' ||
      appName === 'console'
    ) {
      // don't show a pricing table to bsky.storage, tg miniapp or console users
      stripePricingTableId = null
    } else if (isReferred) {
      stripePricingTableId = context.stripeFreeTrialPricingTableId
    } else {
      stripePricingTableId = context.stripePricingTableId
    }
  }
  return toLambdaResponse(
    new html.HtmlResponse(
      (
        <html.ValidateEmail
          email={email}
          audience={audience}
          ucan={ucan}
          stripePricingTableId={stripePricingTableId}
          stripePublishableKey={stripePublishableKey}
          isReferred={isReferred}
        />
      )
    )
  )
}

export const validateEmail = Sentry.AWSLambda.wrapHandler(
  wrapLambdaHandler('validate-email', validateEmailPost)
)
