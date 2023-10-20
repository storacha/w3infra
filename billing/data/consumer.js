import * as Link from 'multiformats/link'
import { DecodeFailure, isDID } from './lib.js'

/**
 * @type {import('../types').Decoder<import('../types').StoreRecord, import('../types').Consumer>}
 */
export const decode = input => {
  if (!isDID(input.consumer)) {
    return { error: new DecodeFailure(`"consumer" is not a DID`) }
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
        consumer: input.consumer,
        provider: input.provider,
        subscription: input.subscription,
        cause: Link.parse(input.cause),
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