import { base58btc } from 'multiformats/bases/base58'
import { EncodeFailure } from './lib.js'

/** @type {import('../lib/api.js').Encoder<import('multiformats').MultihashDigest, string>} */
export const encode = input => {
  try {
    return { ok: base58btc.encode(input.bytes) }
  } catch (/** @type {any} */ err) {
    return {
      error: new EncodeFailure(`encoding multihashes message: ${err.message}`, { cause: err })
    }
  }
}
