import { EncodeFailure, DecodeFailure, Schema } from './lib.js'

/**
 * @typedef {import('../lib/api').Customer} Customer
 * @typedef {import('../types').InferStoreRecord<Customer>} CustomerStoreRecord
 * @typedef {import('../types').StoreRecord} StoreRecord
 * @typedef {import('../lib/api').CustomerKey} CustomerKey
 * @typedef {import('../types').InferStoreRecord<CustomerKey>} CustomerKeyStoreRecord
 */

const schema = Schema.struct({
  customer: Schema.did({ method: 'mailto' }),
  account: Schema.uri({ protocol: 'stripe:' }).optional(),
  product: Schema.text(),
  details: Schema.text().optional(),
  insertedAt: Schema.date(),
  updatedAt: Schema.date().optional()
})

/** @type {import('../lib/api').Validator<Customer>} */
export const validate = input => schema.read(input)

/** @type {import('../lib/api').Encoder<Customer, CustomerStoreRecord>} */
export const encode = input => {
  try {
    return {
      ok: {
        customer: input.customer,
        account: input.account,
        product: input.product,
        details: input.details,
        insertedAt: input.insertedAt.toISOString(),
        updatedAt: input.updatedAt ? input.updatedAt.toISOString() : undefined
      }
    }
  } catch (/** @type {any} */ err) {
    return {
      error: new EncodeFailure(`encoding customer record: ${err.message}`, { cause: err })
    }
  }
}

/** @type {import('../lib/api').Encoder<CustomerKey, CustomerKeyStoreRecord>} */
export const encodeKey = input => ({ ok: { customer: input.customer } })

/** @type {import('../lib/api').Decoder<StoreRecord, Customer>} */
export const decode = input => {
  try { 
    return {
      ok: {
        customer: Schema.did({ method: 'mailto' }).from(input.customer),
        account: input.account ? Schema.uri({ protocol: 'stripe:' }).from(input.account) : undefined,
        product: /** @type {string} */ (input.product),
        details: input.details ? /** @type {string} */ (input.details) : undefined,
        insertedAt: new Date(input.insertedAt),
        updatedAt: input.updatedAt ? new Date(input.updatedAt) : undefined
      }
    }
  } catch (/** @type {any} */ err) {
    return {
      error: new DecodeFailure(`decoding customer record: ${err.message}`, { cause: err })
    }
  }
}
