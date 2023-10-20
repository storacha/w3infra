import * as Link from 'multiformats/link'
import { DecodeFailure, asDID } from './lib.js'

/**
 * @type {import('../types').Decoder<import('../types').StoreRecord, import('../types').Consumer>}
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
 * @type {import('../types').Encoder<import('../types').ConsumerKey, import('../types').InferStoreRecord<import('../types').ConsumerKey>>}
 */
export const encodeKey = input => ({ ok: { consumer: input.consumer } })