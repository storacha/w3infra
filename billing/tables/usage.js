import { createStorePutterClient, createStoreGetterClient } from './client.js'
import { validate, encode, decode, encodeKey } from '../data/usage.js'

/**
 * Stores per space usage across billing periods.
 *
 * @type {import('sst/constructs').TableProps}
 */
export const usageTableProps = {
  fields: {
    /** Composite key with format: "from#provider#space" */
    sk: 'string',
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
    /** Storage provider DID (did:web:...). */
    provider: 'string',
    /** Space DID (did:key:...). */
    space: 'string',
    /**
     * Cumulative usage in byte·milliseconds from the start of the billing month to `to`.
     *
     * IMPORTANT: This is NOT usage from `from` to `to`. The `usage` value represents
     * the cumulative byte·milliseconds from the start of the current billing month
     * (startOfMonth(to)) to the `to` timestamp. For example:
     *
     * - Feb 2 record: { from: Feb 2, to: Feb 3, usage: cumulative_from_Feb_1_to_Feb_3 }
     * - Feb 3 record: { from: Feb 3, to: Feb 4, usage: cumulative_from_Feb_1_to_Feb_4 }
     *
     * The delta sent to Stripe is calculated as: current.usage - previous.usage
     */
    usage: 'number',
    /**
     * ISO timestamp marking the start of this billing run (inclusive).
     *
     * NOTE: This is used for record uniqueness (SK = "from#provider#space"), NOT as
     * the baseline for cumulative usage calculation. The cumulative usage is calculated
     * from the start of the billing month (startOfMonth(to)), not from this date.
     */
    from: 'string',
    /** ISO timestamp marking the end of this billing run (exclusive). */
    to: 'string',
    /** ISO timestamp we created the invoice. */
    insertedAt: 'string'
  },
  primaryIndex: { partitionKey: 'customer', sortKey: 'sk' }
}

/**
 * @param {{ region: string } | import('@aws-sdk/client-dynamodb').DynamoDBClient} conf
 * @param {{ tableName: string }} context
 * @returns {import('../lib/api.js').UsageStore}
 */
export const createUsageStore = (conf, { tableName }) => ({
  ...createStorePutterClient(conf, { tableName, validate, encode }),
  ...createStoreGetterClient(conf, { tableName, encodeKey, decode })
})
