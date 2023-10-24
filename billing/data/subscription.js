import * as Link from 'multiformats/link'
import { DecodeFailure, isDIDMailto, isDID } from './lib.js'

/**
 * @type {import('../lib/api').Encoder<import('../lib/api').SubscriptionKey, import('../types').InferStoreRecord<import('../lib/api').SubscriptionKey>>}
 */
export const encodeKey = input => ({
  ok: {
    provider: input.provider,
    subscription: input.subscription
  }
})

/**
 * @type {import('../lib/api').Decoder<import('../types').StoreRecord, import('../lib/api').Subscription>}
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

/** Encoders/decoders for listings. */
export const lister = {
  /**
   * @type {import('../lib/api').Encoder<import('../lib/api').SubscriptionListKey, import('../types').InferStoreRecord<import('../lib/api').SubscriptionListKey>>}
   */
  encodeKey: input => ({ ok: { customer: input.customer } }),

  /**
   * @type {import('../lib/api').Decoder<import('../types').StoreRecord, Pick<import('../lib/api').Subscription, 'customer'|'provider'|'subscription'|'cause'>>}
   */
  decode: input => {
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
          cause: Link.parse(input.cause)
        }
      }
    } catch (/** @type {any} */ err) {
      return {
        error: new DecodeFailure(`decoding subscription record: ${err.message}`)
      }
    }
  }
}