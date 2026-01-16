import { Table, Bucket, Config } from 'sst/constructs'

import {
  allocationTableProps,
  blobRegistryTableProps,
  storeTableProps,
  uploadTableProps,
  consumerTableProps,
  subscriptionTableProps,
  delegationTableProps,
  revocationTableProps,
  rateLimitTableProps,
  adminMetricsTableProps,
  spaceMetricsTableProps,
  storageProviderTableProps,
  humanodeTableProps,
  replicaTableProps
} from '../upload-api/tables/index.js'
import {
  pieceTableProps
} from '../filecoin/store/index.js'
import { setupSentry, getBucketConfig } from './config.js'

/**
 * @param {import('sst/constructs').StackContext} properties
 */
export function UploadDbStack({ stack, app }) {

  // Setup app monitoring with Sentry
  setupSentry(app, stack)

  // Upload API private key
  const privateKey = new Config.Secret(stack, 'PRIVATE_KEY')

  // Content claims private key
  /** @deprecated */
  const contentClaimsPrivateKey = new Config.Secret(stack, 'CONTENT_CLAIMS_PRIVATE_KEY')

  // Not strictly a secret, but it makes the env vars exceed the 4kb limit...
  const indexingServiceProof = new Config.Secret(stack, 'INDEXING_SERVICE_PROOF')

  // Not strictly a secret, but it makes the env vars exceed the 4kb limit...
  const dealTrackerServiceProof = new Config.Secret(stack, 'DEAL_TRACKER_SERVICE_PROOF')

  const githubClientSecret = new Config.Secret(stack, 'GITHUB_CLIENT_SECRET')
  const humanodeClientSecret = new Config.Secret(stack, 'HUMANODE_CLIENT_SECRET')
  
  // DMAIL SSO secrets
  const dmailApiKey = new Config.Secret(stack, 'DMAIL_API_KEY')
  const dmailApiSecret = new Config.Secret(stack, 'DMAIL_API_SECRET')
  const dmailJwtSecret = new Config.Secret(stack, 'DMAIL_JWT_SECRET')

  // External service configuration - stored as SSM parameters to avoid Lambda env var size limits
  // These are DIDs and URLs that are static per environment. They are NOT exported from this
  // stack - instead, upload-api Lambda functions load them from SSM at cold start. See lib/ssm.js
  // SSM parameters cannot have empty string values, so we only create them if the env var is set.
  // Lambda functions handle missing values gracefully via getSSMParameter() which returns ''.
  if (process.env.AGGREGATOR_DID) {
    new Config.Parameter(stack, 'AGGREGATOR_DID', {
      value: process.env.AGGREGATOR_DID,
    })
  }
  if (process.env.CONTENT_CLAIMS_DID) {
    new Config.Parameter(stack, 'CONTENT_CLAIMS_DID', {
      value: process.env.CONTENT_CLAIMS_DID,
    })
  }
  if (process.env.CONTENT_CLAIMS_URL) {
    new Config.Parameter(stack, 'CONTENT_CLAIMS_URL', {
      value: process.env.CONTENT_CLAIMS_URL,
    })
  }
  if (process.env.INDEXING_SERVICE_DID) {
    new Config.Parameter(stack, 'INDEXING_SERVICE_DID', {
      value: process.env.INDEXING_SERVICE_DID,
    })
  }
  if (process.env.INDEXING_SERVICE_URL) {
    new Config.Parameter(stack, 'INDEXING_SERVICE_URL', {
      value: process.env.INDEXING_SERVICE_URL,
    })
  }
  if (process.env.DEAL_TRACKER_DID) {
    new Config.Parameter(stack, 'DEAL_TRACKER_DID', {
      value: process.env.DEAL_TRACKER_DID,
    })
  }
  if (process.env.DEAL_TRACKER_URL) {
    new Config.Parameter(stack, 'DEAL_TRACKER_URL', {
      value: process.env.DEAL_TRACKER_URL,
    })
  }
  if (process.env.POSTMARK_TOKEN) {
    new Config.Parameter(stack, 'POSTMARK_TOKEN', {
      value: process.env.POSTMARK_TOKEN,
    })
  }
  if (process.env.PROVIDERS) {
    new Config.Parameter(stack, 'PROVIDERS', {
      value: process.env.PROVIDERS,
    })
  }
  if (process.env.R2_ENDPOINT) {
    new Config.Parameter(stack, 'R2_ENDPOINT', {
      value: process.env.R2_ENDPOINT,
    })
  }
  if (process.env.R2_ACCESS_KEY_ID) {
    new Config.Parameter(stack, 'R2_ACCESS_KEY_ID', {
      value: process.env.R2_ACCESS_KEY_ID,
    })
  }
  if (process.env.R2_SECRET_ACCESS_KEY) {
    new Config.Parameter(stack, 'R2_SECRET_ACCESS_KEY', {
      value: process.env.R2_SECRET_ACCESS_KEY,
    })
  }
  if (process.env.R2_REGION) {
    new Config.Parameter(stack, 'R2_REGION', {
      value: process.env.R2_REGION,
    })
  }
  if (process.env.R2_CARPARK_BUCKET_NAME) {
    new Config.Parameter(stack, 'R2_CARPARK_BUCKET', {
      value: process.env.R2_CARPARK_BUCKET_NAME,
    })
  }
  if (process.env.R2_DELEGATION_BUCKET_NAME) {
    new Config.Parameter(stack, 'R2_DELEGATION_BUCKET', {
      value: process.env.R2_DELEGATION_BUCKET_NAME,
    })
  }
  if (process.env.DMAIL_API_URL) {
    new Config.Parameter(stack, 'DMAIL_API_URL', {
      value: process.env.DMAIL_API_URL,
    })
  }
  if (process.env.MAX_REPLICAS) {
    new Config.Parameter(stack, 'MAX_REPLICAS', {
      value: process.env.MAX_REPLICAS,
    })
  }
  if (process.env.PRINCIPAL_MAPPING) {
    new Config.Parameter(stack, 'PRINCIPAL_MAPPING', {
      value: process.env.PRINCIPAL_MAPPING,
    })
  }
  if (process.env.REQUIRE_PAYMENT_PLAN) {
    new Config.Parameter(stack, 'REQUIRE_PAYMENT_PLAN', {
      value: process.env.REQUIRE_PAYMENT_PLAN,
    })
  }
  if (process.env.STRIPE_DEFAULT_SUCCESS_URL) {
    new Config.Parameter(stack, 'STRIPE_SUCCESS_URL', {
      value: process.env.STRIPE_DEFAULT_SUCCESS_URL,
    })
  }
  if (process.env.UPLOAD_API_ALIAS) {
    new Config.Parameter(stack, 'UPLOAD_API_ALIAS', {
      value: process.env.UPLOAD_API_ALIAS,
    })
  }
  if (process.env.UPLOAD_API_DID) {
    new Config.Parameter(stack, 'UPLOAD_API_DID', {
      value: process.env.UPLOAD_API_DID,
    })
  }

  const humanodeTable = new Table(stack, 'humanode', humanodeTableProps)

  /**
   * The allocation table tracks allocated multihashes per space.
   * Used by the blob/* service capabilities.
   */
  const allocationTable = new Table(stack, 'allocation', allocationTableProps)

  /**
   * The blob registry table contains information about blob registrations
   * per space.
   */
  const blobRegistryTable = new Table(stack, 'blob-registry', blobRegistryTableProps)

  /**
   * This table takes a stored CAR and makes an entry in the store table
   * Used by the store/* service capabilities.
   */
  const storeTable = new Table(stack, 'store', storeTableProps)

  /**
   * This table maps stored CAR files (shards) to an upload root cid.
   * Used by the upload/* capabilities.
   */
  const uploadTable = new Table(stack, 'upload', uploadTableProps)

  /**
   * This table takes a stored CAR and makes an entry in the piece table
   * Used by the filecoin/* service capabilities.
   */
  const pieceTable = new Table(stack, 'piece-v2', {
    ...pieceTableProps,
    // information that will be written to the stream
    stream: 'new_image',
  })

  /**
   * This table tracks the relationship between customers and providers.
   */
  const subscriptionTable = new Table(stack, 'subscription', subscriptionTableProps)

  /**
   * This table tracks the relationship between subscriptions and consumers (ie, spaces).
   */
  const consumerTable = new Table(stack, 'consumer', consumerTableProps)

  /**
   * This table tracks rate limits we have imposed on subjects.
   */
  const rateLimitTable = new Table(stack, 'rate-limit', rateLimitTableProps)

  /**
   * This bucket stores delegations extracted from UCAN invocations.
   */
  const delegationBucket = new Bucket(stack, 'delegation-store', {
    cors: true,
    cdk: {
      bucket: getBucketConfig('delegation', app.stage, app.name)
    }
  })

  /**
   * This table indexes delegations.
   */
  const delegationTable = new Table(stack, 'delegation', delegationTableProps)

  /**
   * This table indexes revocations.
   */
  const revocationTable = new Table(stack, 'revocation', revocationTableProps)

  /**
   * This table tracks w3 wider metrics.
   */
  const adminMetricsTable = new Table(stack, 'admin-metrics', adminMetricsTableProps)

  /**
   * This table tracks metrics per space.
   */
  const spaceMetricsTable = new Table(stack, 'space-metrics', spaceMetricsTableProps)

  /**
   * This table tracks storage providers in the system.
   */
  const storageProviderTable = new Table(stack, 'storage-provider', storageProviderTableProps)

  /**
   * This table tracks replicas in the system.
   */
  const replicaTable = new Table(stack, 'replica', replicaTableProps)

  return {
    allocationTable,
    blobRegistryTable,
    humanodeTable,
    storeTable,
    uploadTable,
    pieceTable,
    consumerTable,
    subscriptionTable,
    rateLimitTable,
    delegationBucket,
    delegationTable,
    revocationTable,
    adminMetricsTable,
    spaceMetricsTable,
    storageProviderTable,
    replicaTable,
    privateKey,
    githubClientSecret,
    contentClaimsPrivateKey,
    humanodeClientSecret,
    indexingServiceProof,
    dealTrackerServiceProof,
    dmailApiKey,
    dmailApiSecret,
    dmailJwtSecret,
  }
}
