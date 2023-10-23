import * as Link from 'multiformats/link'
import { DecodeFailure, asDIDMailto } from './lib.js'

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
