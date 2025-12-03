import { Config } from 'sst/node/config'
import { API, error, ok } from '@ucanto/core'
import * as Delegation from '@ucanto/core/delegation'
import { CAR, Legacy, Codec } from '@ucanto/transport'
import { DIDResolutionError, Schema } from '@ucanto/validator'
import * as Link from 'multiformats/link'
import { base64 } from 'multiformats/bases/base64'
import * as Sentry from '@sentry/serverless'
import * as DID from '@ipld/dag-ucan/did'
import Stripe from 'stripe'
import * as Proof from '@storacha/client/proof'
import { Client as IndexingServiceClient } from '@storacha/indexing-service-client'
import * as UploadAPI from '@storacha/upload-api'
import * as UCANCaps from '@storacha/capabilities/ucan'
import {
  composeCarStoresWithOrderedHas,
  createCarStore,
} from '../buckets/car-store.js'
import { createStoreTable } from '../tables/store.js'
import { createUploadTable } from '../tables/upload.js'
import { createPieceTable } from '../../filecoin/store/piece.js'
import { createTaskStore as createFilecoinTaskStore } from '../../filecoin/store/task.js'
import { createReceiptStore as createFilecoinReceiptStore } from '../../filecoin/store/receipt.js'
import { createClient as createFilecoinSubmitQueueClient } from '../../filecoin/queue/filecoin-submit-queue.js'
import { createClient as createPieceOfferQueueClient } from '../../filecoin/queue/piece-offer-queue.js'
import {
  getServiceSigner,
  parseServiceDids,
  getServiceConnection,
} from '../config.js'
import { createUcantoServer } from '../service.js'
import { Email } from '../email.js'
import * as AgentStore from '../stores/agent.js'
import {
  createBlobsStorage,
  composeBlobStoragesWithOrderedHas,
} from '../stores/blobs.js'
import {
  createAllocationTableBlobRegistry,
  createBlobRegistry,
} from '../stores/blob-registry.js'
import { useProvisionStore } from '../stores/provisions.js'
import { useSubscriptionsStore } from '../stores/subscriptions.js'
import { createDelegationsTable } from '../tables/delegations.js'
import {
  createDelegationsStore,
  createR2DelegationsStore,
} from '../buckets/delegations-store.js'
import { createSubscriptionTable } from '../tables/subscription.js'
import { createConsumerTable } from '../tables/consumer.js'
import { createRateLimitTable } from '../tables/rate-limit.js'
import { createMetricsTable as createSpaceMetricsStore } from '../stores/space-metrics.js'
import { createMetricsTable as createAdminMetricsStore } from '../stores/metrics.js'
import { createStorageProviderTable } from '../tables/storage-provider.js'
import { createReplicaTable } from '../tables/replica.js'
import { createRevocationsTable } from '../stores/revocations.js'
import { usePlansStore } from '../stores/plans.js'
import { createCustomerStore } from '../../billing/tables/customer.js'
import { createSpaceDiffStore } from '../../billing/tables/space-diff.js'
import { createSpaceSnapshotStore } from '../../billing/tables/space-snapshot.js'
import { useUsageStore } from '../stores/usage.js'
import { createStripeBillingProvider } from '../billing.js'
import { createIPNIService } from '../external-services/ipni-service.js'
import { mustGetEnv } from '../../lib/env.js'
import { createEgressTrafficQueue } from '../../billing/queues/egress-traffic.js'
import { create as createRoutingService } from '../external-services/router.js'
import { create as createBlobRetriever } from '../external-services/blob-retriever.js'
import {
  createSSOService,
  createDmailSSOService,
} from '../external-services/sso-providers/index.js'
import { uploadServiceURL } from '@storacha/client/service'
import { productInfo } from '../../billing/lib/product-info.js'
import { FREE_TRIAL_COUPONS, PLANS_TO_LINE_ITEMS_MAPPING } from '../constants.js'
import { wrapLambdaHandler } from '../otel.js'

Sentry.AWSLambda.init({
  environment: process.env.SST_STAGE,
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 1,
})

export { API }

/**
 * @typedef {import('../types.js').Receipt} Receipt
 * @typedef {import('@ucanto/interface').Block<Receipt>} BlockReceipt
 * @typedef {object} ExecuteCtx
 * @property {import('@ucanto/interface').Signer} signer
 */

const AWS_REGION = process.env.AWS_REGION || 'us-west-2'
const R2_REGION = process.env.R2_REGION || 'auto'

/**
 * We define a ucanto codec that will switch encoder / decoder based on the
 * `content-type` and `accept` headers of the request.
 */
const codec = Codec.inbound({
  decoders: {
    // If the `content-type` is set to `application/vnd.ipld.car` use CAR codec.
    [CAR.contentType]: CAR.request,
    // If the `content-type` is set to `application/car` use legacy CAR codec
    // which unlike current CAR codec used CAR roots to signal invocations.
    [Legacy.contentType]: Legacy.request,
  },
  encoders: {
    // Legacy clients did not set `accept` header so catch them using `*/*`
    // and encode responses using legacy (CBOR) encoder.
    '*/*;q=0.1': Legacy.response,
    // Modern clients set `accept` header to `application/vnd.ipld.car` and
    // we encode responses to them in CAR encoding.
    [CAR.contentType]: CAR.response,
  },
})

/**
 * Mapping of known WebDIDs to their corresponding DIDKeys for Production and Staging environments.
 * This is used to resolve the DIDKey for known WebDIDs in the `resolveDIDKey` method.
 * It is not a definitive solution, nor a exhaustive list, but rather a stop-gap measure
 * to make it possible for the upload-api to work with Storacha services that use Web DIDs.
 *
 * @type {Record<`did:web:${string}`, `did:key:${string}`>}
 */
export const knownWebDIDs = {
  // Production
  'did:web:up.storacha.network':
    'did:key:z6MkqdncRZ1wj8zxCTDUQ8CRT8NQWd63T7mZRvZUX8B7XDFi',
  'did:web:web3.storage':
    'did:key:z6MkqdncRZ1wj8zxCTDUQ8CRT8NQWd63T7mZRvZUX8B7XDFi', // legacy
  'did:web:w3s.link':
    'did:key:z6Mkha3NLZ38QiZXsUHKRHecoumtha3LnbYEL21kXYBFXvo5',
  'did:web:kms.storacha.network':
    'did:key:z6MksQJobJmBfPhjHWgFXVppqM6Fcjc1k7xu4z6xvusVrtKv',

  // Staging
  'did:web:staging.up.storacha.network':
    'did:key:z6MkhcbEpJpEvNVDd3n5RurquVdqs5dPU16JDU5VZTDtFgnn',
  'did:web:staging.web3.storage':
    'did:key:z6MkhcbEpJpEvNVDd3n5RurquVdqs5dPU16JDU5VZTDtFgnn', // legacy
  'did:web:staging.w3s.link':
    'did:key:z6MkqK1d4thaCEXSGZ6EchJw3tDPhQriwynWDuR55ayATMNf',
  'did:web:staging.kms.storacha.network':
    'did:key:z6MkmRf149D6oc9wq9ioXCsT5fgTn6esd7JjB9S5JnM4Y9qj',
}

/**
 * AWS HTTP Gateway handler for POST / with ucan invocation router.
 *
 * We provide responses in Payload format v2.0
 * see: https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-develop-integrations-lambda.html#http-api-develop-integrations-lambda.proxy-format
 *
 * @param {import('aws-lambda').APIGatewayProxyEventV2} request
 */
export async function ucanInvocationRouter(request) {
  try {
    // Capture X-Client custom header for analytics
    const clientId =
      Object.entries(request.headers).find(
        ([key]) => key.toLowerCase() === 'x-client'
      )?.[1] ?? 'Storacha/?'
    console.log(
      JSON.stringify({
        message: 'Client request',
        clientId,
        requestId: request.requestContext?.requestId || 'unknown',
        timestamp: new Date().toISOString(),
      })
    )
  } catch (error) {
    console.error(error)
  }

  const {
    storeTableName,
    storeBucketName,
    uploadTableName,
    allocationTableName,
    blobRegistryTableName,
    consumerTableName,
    customerTableName,
    subscriptionTableName,
    delegationTableName,
    delegationBucketName,
    revocationTableName,
    adminMetricsTableName,
    spaceMetricsTableName,
    rateLimitTableName,
    pieceTableName,
    spaceDiffTableName,
    spaceSnapshotTableName,
    storageProviderTableName,
    replicaTableName,
    r2DelegationBucketEndpoint,
    r2DelegationBucketAccessKeyId,
    r2DelegationBucketSecretAccessKey,
    r2DelegationBucketName,
    agentIndexBucketName,
    agentMessageBucketName,
    streamName,
    postmarkToken,
    providers,
    aggregatorDid,
    dealTrackerDid,
    dealTrackerUrl,
    pieceOfferQueueUrl,
    filecoinSubmitQueueUrl,
    egressTrafficQueueUrl,
    requirePaymentPlan,
    principalMapping,
    plansToLineItemsMapping,
    couponIds,
    // set for testing
    dbEndpoint,
    accessServiceURL,
    carparkBucketName,
    carparkBucketEndpoint,
    carparkBucketAccessKeyId,
    carparkBucketSecretAccessKey,
    ipniConfig,
    sstStage,
  } = getLambdaEnv()

  if (request.body === undefined) {
    return {
      statusCode: 400,
    }
  }

  const { UPLOAD_API_DID, UPLOAD_API_ALIAS, MAX_REPLICAS } = process.env
  const {
    PRIVATE_KEY,
    STRIPE_SECRET_KEY,
    INDEXING_SERVICE_PROOF,
    DEAL_TRACKER_SERVICE_PROOF,
    CONTENT_CLAIMS_PRIVATE_KEY,
    DMAIL_API_KEY,
    DMAIL_API_SECRET,
    DMAIL_JWT_SECRET,
  } = Config
  const serviceSigner = getServiceSigner({
    did: UPLOAD_API_DID,
    privateKey: PRIVATE_KEY,
  })

  const options = { endpoint: dbEndpoint }
  const metrics = {
    space: createSpaceMetricsStore(AWS_REGION, spaceMetricsTableName, options),
    admin: createAdminMetricsStore(AWS_REGION, adminMetricsTableName, options),
  }

  const agentStore = AgentStore.open({
    store: {
      connection: {
        address: {
          region: AWS_REGION,
        },
      },
      region: AWS_REGION,
      buckets: {
        message: { name: agentMessageBucketName },
        index: { name: agentIndexBucketName },
      },
    },
    stream: {
      connection: { address: {} },
      name: streamName,
    },
  })

  const blobsStorage = composeBlobStoragesWithOrderedHas(
    createBlobsStorage(R2_REGION, carparkBucketName, {
      endpoint: carparkBucketEndpoint,
      credentials: {
        accessKeyId: carparkBucketAccessKeyId,
        secretAccessKey: carparkBucketSecretAccessKey,
      },
    }),
    createBlobsStorage(AWS_REGION, storeBucketName)
  )

  const blobRegistry = createBlobRegistry(
    AWS_REGION,
    blobRegistryTableName,
    spaceDiffTableName,
    consumerTableName,
    metrics,
    options
  )
  const allocationBlobRegistry = createAllocationTableBlobRegistry(
    blobRegistry,
    AWS_REGION,
    allocationTableName,
    options
  )
  const delegationBucket =
    r2DelegationBucketName &&
    r2DelegationBucketEndpoint &&
    r2DelegationBucketAccessKeyId &&
    r2DelegationBucketSecretAccessKey &&
    r2DelegationBucketName
      ? createR2DelegationsStore(
          r2DelegationBucketEndpoint,
          r2DelegationBucketAccessKeyId,
          r2DelegationBucketSecretAccessKey,
          r2DelegationBucketName
        )
      : createDelegationsStore(AWS_REGION, delegationBucketName)
  const subscriptionTable = createSubscriptionTable(
    AWS_REGION,
    subscriptionTableName,
    options
  )
  const consumerTable = createConsumerTable(
    AWS_REGION,
    consumerTableName,
    options
  )
  const customerStore = createCustomerStore(
    { region: AWS_REGION },
    { tableName: customerTableName }
  )
  if (!STRIPE_SECRET_KEY) throw new Error('missing secret: STRIPE_SECRET_KEY')
  const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: '2025-02-24.acacia' })
  const plansStorage = usePlansStore(
    customerStore,
    createStripeBillingProvider(stripe, customerStore, plansToLineItemsMapping, couponIds)
  )
  const rateLimitsStorage = createRateLimitTable(AWS_REGION, rateLimitTableName)
  const spaceDiffStore = createSpaceDiffStore(
    { region: AWS_REGION },
    { tableName: spaceDiffTableName }
  )
  const spaceSnapshotStore = createSpaceSnapshotStore(
    { region: AWS_REGION },
    { tableName: spaceSnapshotTableName }
  )
  const egressTrafficQueue = createEgressTrafficQueue(
    { region: AWS_REGION },
    { url: new URL(egressTrafficQueueUrl) }
  )

  const usageStorage = useUsageStore({
    spaceDiffStore,
    spaceSnapshotStore,
    egressTrafficQueue,
  })

  const provisionsStorage = useProvisionStore(
    subscriptionTable,
    consumerTable,
    customerStore,
    parseServiceDids(providers),
    productInfo
  )
  const subscriptionsStorage = useSubscriptionsStore({ consumerTable })
  const delegationsStorage = createDelegationsTable(
    AWS_REGION,
    delegationTableName,
    { bucket: delegationBucket }
  )
  const revocationsStorage = createRevocationsTable(
    AWS_REGION,
    revocationTableName
  )

  const dealTrackerProofs = []
  if (DEAL_TRACKER_SERVICE_PROOF && DEAL_TRACKER_SERVICE_PROOF !== 'none') {
    const proof = await Proof.parse(DEAL_TRACKER_SERVICE_PROOF)
    dealTrackerProofs.push(proof)
  }

  const dealTrackerConnection = getServiceConnection({
    did: dealTrackerDid,
    url: dealTrackerUrl,
  })

  let ipniService
  if (ipniConfig) {
    ipniService = createIPNIService(
      ipniConfig.blockAdvertisementPublisherQueue,
      ipniConfig.blockIndexWriterQueue,
      blobsStorage
    )
  }

  const claimsServicePrincipal = DID.parse(mustGetEnv('CONTENT_CLAIMS_DID'))
  const claimsServiceURL = new URL(mustGetEnv('CONTENT_CLAIMS_URL'))

  let claimsIssuer = getServiceSigner({
    privateKey: CONTENT_CLAIMS_PRIVATE_KEY,
  })
  const claimsProofs = []
  if (process.env.CONTENT_CLAIMS_PROOF) {
    const cid = Link.parse(process.env.CONTENT_CLAIMS_PROOF, base64)
    const proof = await Delegation.extract(cid.multihash.digest)
    if (!proof.ok)
      throw new Error('failed to extract proof', { cause: proof.error })
    claimsProofs.push(proof.ok)
  } else {
    // if no proofs, we must be using the service private key to sign
    claimsIssuer = claimsIssuer.withDID(claimsServicePrincipal.did())
  }
  const claimsServiceConfig = {
    invocationConfig: {
      issuer: claimsIssuer,
      audience: claimsServicePrincipal,
      with: claimsIssuer.did(),
      proofs: claimsProofs,
    },
    connection: getServiceConnection({
      did: claimsServicePrincipal.did(),
      url: claimsServiceURL.toString(),
    }),
  }

  const indexingServicePrincipal = DID.parse(mustGetEnv('INDEXING_SERVICE_DID'))
  const indexingServiceURL = new URL(mustGetEnv('INDEXING_SERVICE_URL'))

  let indexingServiceProof
  try {
    const cid = Link.parse(INDEXING_SERVICE_PROOF, base64)
    const proof = await Delegation.extract(cid.multihash.digest)
    if (!proof.ok) throw proof.error
    indexingServiceProof = proof.ok
  } catch (err) {
    throw new Error('parsing indexing service proof', { cause: err })
  }

  const indexingServiceConfig = {
    invocationConfig: {
      issuer: serviceSigner,
      audience: indexingServicePrincipal,
      with: indexingServicePrincipal.did(),
      proofs: [indexingServiceProof],
    },
    connection: getServiceConnection({
      did: indexingServicePrincipal.did(),
      url: new URL('/claims', indexingServiceURL).toString(),
    }),
  }
  const indexingServiceClient = new IndexingServiceClient({
    serviceURL: indexingServiceURL,
  })
  const blobRetriever = createBlobRetriever(indexingServiceClient)
  const storageProviderTable = createStorageProviderTable(
    AWS_REGION,
    storageProviderTableName,
    options
  )
  const routingService = createRoutingService(
    storageProviderTable,
    serviceSigner
  )

  /** @type {Array<import('@storacha/upload-api/types').SSOProvider>} */
  const ssoProviders = []
  // Check if DMAIL SSO is configured via SST Config (secrets)
  if (DMAIL_API_KEY && DMAIL_API_SECRET) {
    const dmailSSOService = createDmailSSOService({
      apiKey: DMAIL_API_KEY,
      apiSecret: DMAIL_API_SECRET,
      jwtSecret: DMAIL_JWT_SECRET || 'unused', // if undefined, we set it to a dummy value to bypass JWT validation
      apiUrl:
        process.env.DMAIL_API_URL ||
        'https://api.dmail.ai/open/api/storacha/getUserStatus',
    })
    ssoProviders.push(dmailSSOService)
  }

  // TODO (fforbeck): if more providers are added, we need to add a feature flag for each provider using a list of providers names
  // then if the provider is in the list, we enable the customer trial plan for that provider
  const enableCustomerTrialPlan =
    process.env.ENABLE_CUSTOMER_TRIAL_PLAN === 'true'

  // Build service URL from request data since we're in the same ucan server
  const requestHost = request.headers?.host || request.headers?.Host
  const serviceUrl = requestHost
    ? new URL(`https://${requestHost}`)
    : uploadServiceURL
  const ssoService = ssoProviders.length
    ? createSSOService(
        serviceSigner,
        serviceUrl,
        agentStore,
        customerStore,
        ssoProviders,
        enableCustomerTrialPlan
      )
    : undefined

  let audience // accept invocations addressed to any alias
  const proofs = [] // accept attestations issued by any alias
  if (UPLOAD_API_ALIAS) {
    const aliases = new Set(
      UPLOAD_API_ALIAS.split(',')
        .map((s) => s.trim())
        .filter((s) => s !== serviceSigner.did())
    )
    for (const did of aliases) {
      proofs.push(
        await Delegation.delegate({
          issuer: serviceSigner,
          audience: DID.parse(did),
          capabilities: [
            { can: UCANCaps.attest.can, with: serviceSigner.did() },
          ],
        })
      )
    }
    const audiences = new Set([serviceSigner.did(), ...aliases])
    const audSchemas = [...audiences].map((did) => Schema.literal(did))
    if (audSchemas.length > 1) {
      audience = Schema.union([audSchemas[0], ...audSchemas.slice(1)])
    }
  }

  const server = createUcantoServer(serviceSigner, {
    codec,
    // @ts-expect-error needs update of upload-api
    audience,
    proofs,
    router: routingService,
    registry: allocationBlobRegistry,
    blobsStorage,
    blobRetriever,
    resolveDIDKey: (did) =>
      Schema.did({ method: 'web' }).is(did) && principalMapping[did]
        ? ok([principalMapping[did]])
        : error(new DIDResolutionError(did)),
    getServiceConnection: () => connection,
    // TODO: to be deprecated with `store/*` protocol
    storeTable: createStoreTable(AWS_REGION, storeTableName, {
      endpoint: dbEndpoint,
    }),
    // TODO: to be deprecated with `store/*` protocol
    carStoreBucket: composeCarStoresWithOrderedHas(
      createCarStore(AWS_REGION, storeBucketName),
      createCarStore(R2_REGION, carparkBucketName, {
        endpoint: carparkBucketEndpoint,
        credentials: {
          accessKeyId: carparkBucketAccessKeyId,
          secretAccessKey: carparkBucketSecretAccessKey,
        },
      })
    ),
    uploadTable: createUploadTable(
      AWS_REGION,
      uploadTableName,
      metrics,
      options
    ),
    signer: serviceSigner,
    // TODO: we should set URL from a different env var, doing this for now to avoid that refactor - tracking in https://github.com/web3-storage/w3infra/issues/209
    url: new URL(accessServiceURL),
    email: new Email({
      token: postmarkToken,
      environment: ['prod', 'forge-prod'].includes(sstStage)
        ? undefined
        : sstStage,
    }),
    agentStore,
    provisionsStorage,
    subscriptionsStorage,
    delegationsStorage,
    revocationsStorage,
    rateLimitsStorage,
    aggregatorId: DID.parse(aggregatorDid),
    pieceStore: createPieceTable(AWS_REGION, pieceTableName),
    taskStore: createFilecoinTaskStore(
      AWS_REGION,
      agentIndexBucketName,
      agentMessageBucketName
    ),
    receiptStore: createFilecoinReceiptStore(
      AWS_REGION,
      agentIndexBucketName,
      agentMessageBucketName
    ),
    pieceOfferQueue: createPieceOfferQueueClient(
      { region: AWS_REGION },
      { queueUrl: pieceOfferQueueUrl }
    ),
    filecoinSubmitQueue: createFilecoinSubmitQueueClient(
      { region: AWS_REGION },
      { queueUrl: filecoinSubmitQueueUrl }
    ),
    dealTrackerService: {
      connection: dealTrackerConnection,
      invocationConfig: {
        issuer: dealTrackerProofs.length
          ? serviceSigner
          : getServiceSigner({
              privateKey: PRIVATE_KEY,
              did: dealTrackerDid,
            }),
        audience: dealTrackerConnection.id,
        with: dealTrackerConnection.id.did(),
        proofs: dealTrackerProofs
      },
    },
    plansStorage,
    requirePaymentPlan,
    usageStorage,
    ipniService,
    claimsService: claimsServiceConfig,
    indexingService: indexingServiceConfig,
    maxReplicas: MAX_REPLICAS ? parseInt(MAX_REPLICAS) : 2,
    replicaStore: createReplicaTable(AWS_REGION, replicaTableName),
    ssoService,
  })

  const connection = UploadAPI.connect({
    id: serviceSigner,
    channel: server,
  })

  const payload = fromLambdaRequest(request)
  const response = await UploadAPI.handle(server, payload)

  return toLambdaResponse(response)
}

export const handler = Sentry.AWSLambda.wrapHandler(
  wrapLambdaHandler('ucan-invocation-router', ucanInvocationRouter)
)

/**
 * @param {API.HTTPResponse} response
 */
export function toLambdaResponse({ status = 200, headers, body }) {
  return {
    statusCode: status,
    headers,
    body: Buffer.from(body).toString('base64'),
    isBase64Encoded: true,
  }
}

/**
 * @param {import('aws-lambda').APIGatewayProxyEventV2} request
 */
export const fromLambdaRequest = (request) => ({
  headers: /** @type {Record<string, string>} */ (request.headers),
  body: Buffer.from(request.body || '', 'base64'),
})

function getLambdaEnv() {
  return {
    storeTableName: mustGetEnv('STORE_TABLE'),
    storeBucketName: mustGetEnv('STORE_BUCKET'),
    uploadTableName: mustGetEnv('UPLOAD_TABLE'),
    allocationTableName: mustGetEnv('ALLOCATION_TABLE'),
    blobRegistryTableName: mustGetEnv('BLOB_REGISTRY_TABLE'),
    consumerTableName: mustGetEnv('CONSUMER_TABLE'),
    customerTableName: mustGetEnv('CUSTOMER_TABLE'),
    subscriptionTableName: mustGetEnv('SUBSCRIPTION_TABLE'),
    delegationBucketName: mustGetEnv('DELEGATION_BUCKET'),
    delegationTableName: mustGetEnv('DELEGATION_TABLE'),
    revocationTableName: mustGetEnv('REVOCATION_TABLE'),
    spaceMetricsTableName: mustGetEnv('SPACE_METRICS_TABLE'),
    adminMetricsTableName: mustGetEnv('ADMIN_METRICS_TABLE'),
    rateLimitTableName: mustGetEnv('RATE_LIMIT_TABLE'),
    pieceTableName: mustGetEnv('PIECE_TABLE'),
    spaceDiffTableName: mustGetEnv('SPACE_DIFF_TABLE'),
    spaceSnapshotTableName: mustGetEnv('SPACE_SNAPSHOT_TABLE'),
    storageProviderTableName: mustGetEnv('STORAGE_PROVIDER_TABLE'),
    replicaTableName: mustGetEnv('REPLICA_TABLE'),
    pieceOfferQueueUrl: mustGetEnv('PIECE_OFFER_QUEUE_URL'),
    filecoinSubmitQueueUrl: mustGetEnv('FILECOIN_SUBMIT_QUEUE_URL'),
    egressTrafficQueueUrl: mustGetEnv('EGRESS_TRAFFIC_QUEUE_URL'),
    r2DelegationBucketEndpoint: process.env.R2_ENDPOINT,
    r2DelegationBucketAccessKeyId: process.env.R2_ACCESS_KEY_ID,
    r2DelegationBucketSecretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    r2DelegationBucketName: process.env.R2_DELEGATION_BUCKET,
    agentIndexBucketName: mustGetEnv('AGENT_INDEX_BUCKET'),
    agentMessageBucketName: mustGetEnv('AGENT_MESSAGE_BUCKET'),
    streamName: mustGetEnv('UCAN_LOG_STREAM'),
    postmarkToken: mustGetEnv('POSTMARK_TOKEN'),
    providers: mustGetEnv('PROVIDERS'),
    accessServiceURL: mustGetEnv('UPLOAD_SERVICE_URL'),
    uploadServiceURL: mustGetEnv('UPLOAD_SERVICE_URL'),
    aggregatorDid: mustGetEnv('AGGREGATOR_DID'),
    requirePaymentPlan: process.env.REQUIRE_PAYMENT_PLAN === 'true',
    dealTrackerDid: mustGetEnv('DEAL_TRACKER_DID'),
    dealTrackerUrl: mustGetEnv('DEAL_TRACKER_URL'),
    // carpark bucket - CAR file bytes may be found here with keys like {cid}/{cid}.car
    carparkBucketName: mustGetEnv('R2_CARPARK_BUCKET'),
    carparkBucketEndpoint: mustGetEnv('R2_ENDPOINT'),
    carparkBucketAccessKeyId: mustGetEnv('R2_ACCESS_KEY_ID'),
    carparkBucketSecretAccessKey: mustGetEnv('R2_SECRET_ACCESS_KEY'),
    // IPNI service
    ipniConfig:
      process.env.DISABLE_IPNI_PUBLISHING === 'true'
        ? null
        : {
            blockAdvertisementPublisherQueue: {
              url: new URL(mustGetEnv('BLOCK_ADVERT_PUBLISHER_QUEUE_URL')),
              region: AWS_REGION,
            },
            blockIndexWriterQueue: {
              url: new URL(mustGetEnv('BLOCK_INDEX_WRITER_QUEUE_URL')),
              region: AWS_REGION,
            },
          },
    sstStage: mustGetEnv('SST_STAGE'),
    principalMapping:
      /** @type {Record<`did:web:${string}`, `did:key:${string}`>} */
      ({
        ...knownWebDIDs,
        ...JSON.parse(process.env.PRINCIPAL_MAPPING || '{}'),
      }),
    // default to staging values for line items since that's the default Stripe sandbox
    plansToLineItemsMapping: PLANS_TO_LINE_ITEMS_MAPPING[mustGetEnv('SST_STAGE')] ?? PLANS_TO_LINE_ITEMS_MAPPING.staging,
    couponIds: FREE_TRIAL_COUPONS[mustGetEnv('SST_STAGE')] ?? FREE_TRIAL_COUPONS.staging,
    // set for testing
    dbEndpoint: process.env.DYNAMO_DB_ENDPOINT,
  }
}
