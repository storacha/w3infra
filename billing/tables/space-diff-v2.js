import { createStoreBatchPutterClient, createStoreListerClient } from './client.js'
import { validate, encode, lister, decode } from '../data/space-diff.js'

/**
 * Stores changes to total space size with structural uniqueness by cause.
 *
 * PK: provider#space
 * SK: cause (Link V1 string)
 *
 * @type {import('sst/constructs').TableProps}
 */
export const spaceDiffV2TableProps = {
  fields: {
    /** Composite key with format: "provider#space" */
    pk: 'string',
    /** Sort key and unique identifier per invocation cause (bafy...) */
    cause: 'string',
    /** Space DID (did:key:...). */
    space: 'string',
    /** Storage provider for the space. */
    provider: 'string',
    /** Subscription in use when the size changed. */
    subscription: 'string',
    /** Number of bytes added to or removed from the space. */
    delta: 'number',
    /** ISO timestamp the receipt was issued. */
    receiptAt: 'string',
    /** ISO timestamp we recorded the change. */
    insertedAt: 'string'
    // Optional future: ttlAt (Number epoch seconds) for DynamoDB TTL
  },
  primaryIndex: { partitionKey: 'pk', sortKey: 'cause' },
  globalIndexes: {
    /** Time-ordered queries for billing/reporting */
    byReceiptAt: { partitionKey: 'pk', sortKey: 'receiptAt' }
  }
}

/**
 * v2 store clients (reuse existing validators/encoders)
 *
 * @param {{ region: string } | import('@aws-sdk/client-dynamodb').DynamoDBClient} conf
 * @param {{ tableName: string }} context
 * @returns {import('../lib/api.js').SpaceDiffStore}
 */
export const createSpaceDiffV2Store = (conf, { tableName }) => ({
  ...createStoreBatchPutterClient(conf, { tableName, validate, encode }),
  ...createStoreListerClient(conf, { tableName, encodeKey: lister.encodeKey, decode })
})
