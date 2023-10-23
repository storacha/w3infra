import * as Link from 'multiformats/link'
import { DecodeFailure, asDID } from './lib.js'

/**
 * @type {import('../lib/api').Decoder<import('../lib/api').StoreRecord, import('../lib/api').Consumer>}
 */
export const decode = input => {
  try { 
    return {
      ok: {
        consumer: asDID(input.consumer),
        provider: asDID(input.provider),
        subscription: String(input.subscription),
        cause: Link.parse(String(input.cause)),
        insertedAt: new Date(input.insertedAt),
        updatedAt: new Date(input.updatedAt)
      }
    }
  } catch (/** @type {any} */ err) {
    return {
      error: new DecodeFailure(`decoding consumer record: ${err.message}`)
    }
  }
}

/**
 * @type {import('../lib/api').Encoder<import('../lib/api').ConsumerKey, import('../lib/api').InferStoreRecord<import('../lib/api').ConsumerKey>>}
 */
export const encodeKey = input => ({
  ok: {
    subscription: input.subscription,
    provider: input.provider
  }
})

/** Encoders/decoders for listings. */
export const lister = {
  /**
   * @type {import('../lib/api').Encoder<import('../lib/api').ConsumerListKey, import('../lib/api').InferStoreRecord<import('../lib/api').ConsumerListKey>>}
   */
  encodeKey: input => ({ ok: { consumer: input.consumer } }),
  /**
   * @type {import('../lib/api').Decoder<import('../lib/api').StoreRecord, Pick<import('../lib/api').Consumer, 'consumer'|'provider'|'subscription'>>}
   */
  decode: input => {
    try { 
      return {
        ok: {
          consumer: asDID(input.consumer),
          provider: asDID(input.provider),
          subscription: String(input.subscription)
        }
      }
    } catch (/** @type {any} */ err) {
      return {
        error: new DecodeFailure(`decoding consumer list record: ${err.message}`)
      }
    }
  }
}
