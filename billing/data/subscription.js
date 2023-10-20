import { DID } from '@ucanto/server'
import * as DIDMailto from '@web3-storage/did-mailto'
import * as Link from 'multiformats/link'
import { DecodeFailure } from './lib.js'

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
 * @type {import('../types').Decoder<import('../types').StoreRecord, import('../types').Subscription>}
 */
export const decode = input => {
  try {
    return {
      ok: {
        customer: DIDMailto.fromString(input.customer),
        provider: DID.parse(input.provider).did(),
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


