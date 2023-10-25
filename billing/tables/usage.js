import { createStorePutterClient } from './client.js'
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
    /** ISO timestamp the usage period spans from (inclusive). */
    from: 'string',
    /** ISO timestamp the usage period spans to (exclusive). */
    to: 'string',
    /** ISO timestamp we created the invoice. */
    insertedAt: 'string'
  },
  primaryIndex: { partitionKey: 'customer', sortKey: 'from' }
}

/**
 * @param {{ region: string } | import('@aws-sdk/client-dynamodb').DynamoDBClient} conf
 * @param {{ tableName: string }} context
 * @returns {import('../lib/api').UsageStore}
 */
export const createUsageStore = (conf, { tableName }) =>
  createStorePutterClient(conf, { tableName, validate, encode })
