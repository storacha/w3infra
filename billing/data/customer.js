import * as Link from 'multiformats/link'
import { EncodeFailure, DecodeFailure, asDIDMailto } from './lib.js'

/**
 * @type {import('../lib/api').Encoder<import('../lib/api').Customer, import('../types').InferStoreRecord<import('../lib/api').Customer>>}
 */
export const encode = input => {
  try {
    return {
      ok: {
        cause: input.cause.toString(),
        customer: input.customer,
        account: input.account,
        product: input.product,
        insertedAt: input.insertedAt.toISOString(),
        updatedAt: input.updatedAt.toISOString()
      }
    }
  } catch (/** @type {any} */ err) {
    return {
      error: new EncodeFailure(`encoding customer record: ${err.message}`)
    }
  }
}

/**
 * @type {import('../lib/api').Decoder<import('../types').StoreRecord, import('../lib/api').Customer>}
 */
export const decode = input => {
  try { 
    return {
      ok: {
        cause: Link.parse(String(input.cause)),
        customer: asDIDMailto(input.customer),
        account: String(input.account),
        product: String(input.product),
        insertedAt: new Date(input.insertedAt),
        updatedAt: new Date(input.updatedAt)
      }
    }
  } catch (/** @type {any} */ err) {
    return {
      error: new DecodeFailure(`decoding customer record: ${err.message}`)
    }
  }
}
