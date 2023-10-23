import { createStoreListerClient } from './client.js'
import { decode } from '../data/customer.js'

/**
 * Stores customer details.
 *
 * @type {import('@serverless-stack/resources').TableProps}
 */
export const customerTableProps = {
  fields: {
    /** CID of the UCAN invocation that set it to the current value. */
    cause: 'string',
    /** DID of the user account e.g. `did:mailto:agent`. */
    customer: 'string',
    /**
     * Opaque identifier representing an account in the payment system.
     *
     * e.g. Stripe customer ID (stripe:cus_9s6XKzkNRiz8i3)
     */
    account: 'string',
    /** Unique identifier of the product a.k.a tier. */
    product: 'string',
    /** ISO timestamp record was inserted. */
    insertedAt: 'string',
    /** ISO timestamp record was updated. */
    updatedAt: 'string'
  },
  primaryIndex: { partitionKey: 'customer' },
  globalIndexes: {
    account: { partitionKey: 'account', projection: ['customer'] }
  }
}

/**
 * @param {string} region 
 * @param {string} tableName
 * @param {object} [options]
 * @param {URL} [options.endpoint]
 * @returns {import('../lib/api').CustomerStore}
 */
export const createCustomerStore = (region, tableName, options) =>
  createStoreListerClient({ region }, {
    tableName,
    encodeKey: () => ({ ok: {} }),
    decode
  })
