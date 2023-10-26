import * as Link from 'multiformats/link'
import { EncodeFailure, DecodeFailure, InvalidInput, isDIDMailto, isDID, asDIDMailto, asDID, asDIDWeb, isDIDWeb } from './lib.js'

/** @type {import('../lib/api').Validator<import('../lib/api').SpaceDiff>} */
export const validate = input => {
  if (input == null || typeof input !== 'object') {
    return { error: new InvalidInput('not an object') }
  }
  if (!isDIDMailto(input.customer)) {
    return { error: new InvalidInput('not a mailto DID', 'customer') }
  }
  if (!isDID(input.space)) {
    return { error: new InvalidInput('not a DID', 'space') }
  }
  if (!isDIDWeb(input.provider)) {
    return { error: new InvalidInput('not a web DID', 'provider') }
  }
  if (typeof input.subscription !== 'string') {
    return { error: new InvalidInput('not a string', 'subscription') }
  }
  if (!Link.isLink(input.cause)) {
    return { error: new InvalidInput('not a CID instance', 'cause') }
  }
  if (!(input.receiptAt instanceof Date)) {
    return { error: new InvalidInput('not a Date instance', 'receiptAt') }
  }
  if (!(input.insertedAt instanceof Date)) {
    return { error: new InvalidInput('not a Date instance', 'insertedAt') }
  }
  return { ok: {} }
}

/**
 * @type {import('../lib/api').Encoder<import('../lib/api').SpaceDiff, import('../types').InferStoreRecord<import('../lib/api').SpaceDiff>>}
 */
export const encode = input => {
  try {
    return {
      ok: {
        customer: input.customer,
        space: input.space,
        provider: input.provider,
        subscription: input.subscription,
        cause: input.cause.toString(),
        change: input.change,
        receiptAt: input.receiptAt.toISOString(),
        insertedAt: new Date().toISOString()
      }
    }
  } catch (/** @type {any} */ err) {
    return {
      error: new EncodeFailure(`encoding space diff record: ${err.message}`)
    }
  }
}

/**
 * @type {import('../lib/api').Encoder<import('../lib/api').SpaceDiffKey, import('../types').InferStoreRecord<import('../lib/api').SpaceDiffKey>>}
 */
export const encodeKey = input => ({ ok: { customer: input.customer } })

/**
 * @type {import('../lib/api').Decoder<import('../types').StoreRecord, import('../lib/api').SpaceDiff>}
 */
export const decode = input => {
  try {
    return {
      ok: {
        customer: asDIDMailto(input.customer),
        space: asDID(input.space),
        provider: asDIDWeb(input.provider),
        subscription: String(input.subscription),
        cause: Link.parse(String(input.cause)),
        change: Number(input.change),
        receiptAt: new Date(input.receiptAt),
        insertedAt: new Date(input.insertedAt)
      }
    }
  } catch (/** @type {any} */ err) {
    return {
      error: new DecodeFailure(`decoding space diff record: ${err.message}`)
    }
  }
}
