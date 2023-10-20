import { createWritableStoreClient } from './client.js'
import { validate, encode } from '../data/usage.js'

/**
 * Stores per space usage across billing periods.
 *
 * @type {import('@serverless-stack/resources').TableProps}
 */
export const usageTableProps = {
  fields: {
    /** Customer DID (did:mailto:...). */
    customer: 'string',
    /**
     * Opaque identifier representing an account in the payment system.
     * 
     * e.g. Stripe customer ID (stripe:cus_9s6XKzkNRiz8i3)
     */
    account: 'string',
    /** Unique identifier of the product a.k.a tier. */
    product: 'string',
    /** Space DID (did:key:...). */
    space: 'string',
    /** Usage in GB/month */
    usage: 'number',
    /**
     * Dual ISO timestamp the invoice covers - inclusive from, exclusive to.
     * 
     * e.g. 2023-10-01T00:00:00.000Z - 2023-11-01T00:00:00.000Z
     */
    period: 'string',
    /** ISO timestamp we created the invoice. */
    insertedAt: 'string'
  },
  primaryIndex: { partitionKey: 'customer', sortKey: 'period' }
}

/**
 * @param {string} region 
 * @param {string} tableName
 * @param {object} [options]
 * @param {URL} [options.endpoint]
 */
export const createUsageStore = (region, tableName, options) =>
  createWritableStoreClient({ region }, { tableName, validate, encode })
