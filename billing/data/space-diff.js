import { DID } from '@ucanto/server'
import * as Link from 'multiformats/link'
import { EncodeFailure, DecodeFailure, InvalidInput, isDIDMailto, isDID } from './lib.js'

/** @type {import('../types').Validator<import('../types').SpaceDiff>} */
export const validate = input => {
  if (input == null || typeof input !== 'object') {
    return { error: new InvalidInput('not an object') }
  }
  for (const field of ['customer', 'space', 'provider']) {
    try {
      // @ts-expect-error
      DID.parse(input[field])
    } catch (/** @type {any} */ err) {
      return { error: new InvalidInput(err.message, field) }
    }
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
 * @type {import('../types').Encoder<import('../types').SpaceDiff, import('../types').InferStoreRecord<import('../types').SpaceDiff>>}
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
 * @type {import('../types').Decoder<import('../types').StoreRecord, import('../types').SpaceDiff>}
 */
export const decode = input => {
  if (!isDIDMailto(input.customer)) {
    return { error: new DecodeFailure(`"customer" is not a mailto DID`) }
  }
  if (!isDID(input.space)) {
    return { error: new DecodeFailure(`"space" is not a DID`) }
  }
  if (!isDID(input.provider)) {
    return { error: new DecodeFailure(`"provider" is not a DID`) }
  }
  if (typeof input.subscription !== 'string') {
    return { error: new DecodeFailure(`"subscription" is not a string`) }
  }
  if (typeof input.product !== 'string') {
    return { error: new DecodeFailure(`"product" is not a string`) }
  }
  if (typeof input.cause !== 'string') {
    return { error: new DecodeFailure(`"cause" is not a string`) }
  }
  if (typeof input.change !== 'number') {
    return { error: new DecodeFailure(`"change" is not a number`) }
  }
  try {
    return {
      ok: {
        customer: input.customer,
        space: input.space,
        provider: input.provider,
        subscription: input.subscription,
        cause: Link.parse(input.cause),
        change: input.change,
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
