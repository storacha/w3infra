import { DID } from '@ucanto/server'
import { EncodeFailure, InvalidInput } from './lib.js'

/** @type {import('../lib/api').Validator<import('../lib/api').Usage>} */
export const validate = input => {
  if (input == null || typeof input !== 'object') {
    return { error: new InvalidInput('not an object') }
  }
  for (const field of ['customer', 'space']) {
    try {
      // @ts-expect-error
      DID.parse(input[field])
    } catch (/** @type {any} */ err) {
      return { error: new InvalidInput(err.message, field) }
    }
  }
  if (typeof input.account !== 'string') {
    return { error: new InvalidInput('not a string', 'account') }
  }
  if (typeof input.product !== 'string') {
    return { error: new InvalidInput('not a string', 'product') }
  }
  if (Number.isSafeInteger(input.usage)) {
    return { error: new InvalidInput('not a number', 'usage') }
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

/** @type {import('../lib/api').Encoder<import('../lib/api').Usage, import('../lib/api').InferStoreRecord<import('../lib/api').Usage>>} */
export const encode = input => {
  try {
    return {
      ok: {
        ...input,
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
