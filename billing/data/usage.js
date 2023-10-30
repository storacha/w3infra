import { DecodeFailure, EncodeFailure, InvalidInput, isDID, isDIDMailto, isDIDWeb } from './lib.js'

/**
 * @typedef {import('../lib/api').Usage} Usage
 * @typedef {import('../types').InferStoreRecord<Usage> & { sk: string }} UsageStoreRecord
 * @typedef {import('../lib/api').UsageListKey} UsageListKey
 * @typedef {Omit<import('../types').InferStoreRecord<UsageListKey>, 'from'> & { sk: string }} UsageListKeyStoreRecord
 * @typedef {import('../types').StoreRecord} StoreRecord
 */

/** @type {import('../lib/api').Validator<Usage>} */
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
  if (typeof input.account !== 'string') {
    return { error: new InvalidInput('not a string', 'account') }
  }
  if (typeof input.product !== 'string') {
    return { error: new InvalidInput('not a string', 'product') }
  }
  if (typeof input.usage !== 'bigint') {
    return { error: new InvalidInput('not a bigint', 'usage') }
  }
  if (!(input.from instanceof Date)) {
    return { error: new InvalidInput('not a Date instance', 'from') }
  }
  if (!(input.to instanceof Date)) {
    return { error: new InvalidInput('not a Date instance', 'to') }
  }
  if (!(input.insertedAt instanceof Date)) {
    return { error: new InvalidInput('not a Date instance', 'insertedAt') }
  }
  return { ok: {} }
}

/** @type {import('../lib/api').Encoder<Usage, UsageStoreRecord>} */
export const encode = input => {
  try {
    return {
      ok: {
        sk: `${input.from.toISOString()}#${input.provider}#${input.space}`,
        customer: input.customer,
        account: input.account,
        product: input.product,
        provider: input.provider,
        space: input.space,
        usage: input.usage.toString(),
        from: input.from.toISOString(),
        to: input.to.toISOString(),
        insertedAt: input.insertedAt.toISOString()
      }
    }
  } catch (/** @type {any} */ err) {
    return {
      error: new EncodeFailure(`encoding usage record: ${err.message}`)
    }
  }
}

export const lister = {
  /** @type {import('../lib/api').Encoder<UsageListKey, UsageListKeyStoreRecord>} */
  encodeKey: input => ({
    ok: {
      customer: input.customer,
      sk: input.from.toISOString()
    }
  })
}



/** @type {import('../lib/api').Decoder<StoreRecord, Usage>} */
export const decode = input => {
  if (!isDIDMailto(input.customer)) {
    return { error: new DecodeFailure(`"customer" is not a mailto DID`) }
  }
  if (!isDID(input.space)) {
    return { error: new DecodeFailure(`"space" is not a DID`) }
  }
  if (!isDIDWeb(input.provider)) {
    return { error: new DecodeFailure(`"provider" is not a web DID`) }
  }
  try {
    return {
      ok: {
        customer: input.customer,
        account: String(input.account),
        product: String(input.product),
        provider: input.provider,
        space: input.space,
        usage: BigInt(input.usage),
        from: new Date(input.from),
        to: new Date(input.to),
        insertedAt: new Date(input.insertedAt)
      }
    }
  } catch (/** @type {any} */ err) {
    return {
      error: new DecodeFailure(`decoding usage record: ${err.message}`)
    }
  }
}
