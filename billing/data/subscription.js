import * as Link from 'multiformats/link'
import { DecodeFailure, isDIDMailto, isDID } from './lib.js'

/**
 * @type {import('../types').Encoder<import('../types').SubscriptionKey, import('../types').InferStoreRecord<import('../types').SubscriptionKey>>}
 */
export const encodeKey = input => ({
  ok: {
    provider: input.provider,
    subscription: input.subscription
  }
})

/**
 * @type {import('../types').Encoder<import('../types').SubscriptionListKey, import('../types').InferStoreRecord<import('../types').SubscriptionListKey>>}
 */
export const encodeListKey = input => ({ ok: { customer: input.customer } })

/**
 * @type {import('../types').Decoder<import('../types').StoreRecord, import('../types').Subscription>}
 */
export const decode = input => {
  if (!isDIDMailto(input.customer)) {
    return { error: new DecodeFailure(`"customer" is not a mailto DID`) }
  }
  if (!isDID(input.provider)) {
    return { error: new DecodeFailure(`"provider" is not a DID`) }
  }
  if (typeof input.subscription !== 'string') {
    return { error: new DecodeFailure(`"subscription" is not a string`) }
  }
  if (typeof input.cause !== 'string') {
    return { error: new DecodeFailure(`"cause" is not a string`) }
  }
  try {
    return {
      ok: {
        customer: input.customer,
        provider: input.provider,
        subscription: input.subscription,
        cause: Link.parse(input.cause),
        insertedAt: new Date(input.insertedAt),
        updatedAt: new Date(input.updatedAt)
      }
    }
  } catch (/** @type {any} */ err) {
    return {
      error: new DecodeFailure(`decoding subscription record: ${err.message}`)
    }
  }
}


