import { Table, Bucket, Config } from 'sst/constructs'

import {
  allocationTableProps,
  storeTableProps,
  uploadTableProps,
  consumerTableProps,
  subscriptionTableProps,
  delegationTableProps,
  revocationTableProps,
  rateLimitTableProps,
  adminMetricsTableProps,
  spaceMetricsTableProps
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
  // TODO: we should look into creating a trust layer for content claims
  const contentClaimsPrivateKey = new Config.Secret(stack, 'CONTENT_CLAIMS_PRIVATE_KEY')

  const githubClientSecret = new Config.Secret(stack, 'GITHUB_CLIENT_SECRET')

  /**
   * The allocation table tracks allocated multihashes per space.
   * Used by the blob/* service capabilities.
   */
  const allocationTable = new Table(stack, 'allocation', allocationTableProps)

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
      bucket: getBucketConfig('delegation', app.stage)
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

  return {
    allocationTable,
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
    privateKey,
    contentClaimsPrivateKey,
    githubClientSecret
  }
}
