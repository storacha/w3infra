import * as Link from 'multiformats/link'
import { DecodeFailure, isDIDMailto } from './lib.js'

/**
 * @type {import('../types').Decoder<import('../types').StoreRecord, import('../types').Customer>}
 */
export const decode = input => {
  if (!isDIDMailto(input.customer)) {
    return { error: new DecodeFailure(`"customer" is not a mailto DID`) }
  }
  if (typeof input.account !== 'string') {
    return { error: new DecodeFailure(`"account" is not a string`) }
  }
  if (typeof input.product !== 'string') {
    return { error: new DecodeFailure(`"product" is not a string`) }
  }
  if (typeof input.cause !== 'string') {
    return { error: new DecodeFailure(`"cause" is not a string`) }
  }
  try { 
    return {
      ok: {
        cause: Link.parse(input.cause),
        customer: input.customer,
        account: input.account,
        product: input.product,
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
