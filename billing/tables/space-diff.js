import { createWritableStoreClient } from './client.js'
import { validate, encode } from '../data/space-diff.js'

/**
 * Stores changes to total space size.
 *
 * @type {import('@serverless-stack/resources').TableProps}
 */
export const spaceDiffTableProps = {
  fields: {
    /** Customer DID (did:mailto:...). */
    customer: 'string',
    /** Space DID (did:key:...). */
    space: 'string',
    /** Storage provider for the space. */
    provider: 'string',
    /** Subscription in use when the size changed. */
    subscription: 'string',
    /** Invocation CID that changed the space size (bafy...). */
    cause: 'string',
    /** Number of bytes added to or removed from the space. */
    change: 'number',
    /** ISO timestamp the receipt was issued. */
    receiptAt: 'string',
    /** ISO timestamp we recorded the change. */
    insertedAt: 'string'
  },
  primaryIndex: { partitionKey: 'customer', sortKey: 'receiptAt' }
}

/**
 * @param {string} region 
 * @param {string} tableName
 * @param {object} [options]
 * @param {URL} [options.endpoint]
 * @returns {import('../types.js').SpaceDiffStore}
 */
export const createSpaceDiffStore = (region, tableName, options) => 
  createWritableStoreClient({ region }, { tableName, validate, encode })
