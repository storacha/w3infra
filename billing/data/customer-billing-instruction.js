import * as dagJSON from '@ipld/dag-json'
import { EncodeFailure, DecodeFailure, InvalidInput, isDIDMailto } from './lib.js'

/** @type {import('../types.js').Validator<import('../types.js').CustomerBillingInstruction>} */
export const validate = input => {
  if (input == null || typeof input !== 'object') {
    return { error: new InvalidInput('not an object') }
  }
  if (!isDIDMailto(input.customer)) {
    return { error: new InvalidInput('not a DID', 'customer') }
  }
  if (typeof input.account !== 'string') {
    return { error: new InvalidInput('not a string', 'account') }
  }
  if (typeof input.product !== 'string') {
    return { error: new InvalidInput('not a string', 'product') }
  }
  if (!(input.from instanceof Date)) {
    return { error: new InvalidInput('not a Date instance', 'from') }
  }
  if (!(input.to instanceof Date)) {
    return { error: new InvalidInput('not a Date instance', 'to') }
  }
  return { ok: {} }
}

/** @type {import('../types.js').Encoder<import('../types.js').CustomerBillingInstruction, string>} */
export const encode = message => {
  try {
    const data = {
      ...message,
      from: message.from.toISOString(),
      to: message.to.toISOString()
    }
    return { ok: dagJSON.stringify(data) }
  } catch (/** @type {any} */ err) {
    return {
      error: new EncodeFailure(`encoding billing instruction message: ${err.message}`)
    }
  }
}

/** @type {import('../types.js').Decoder<string, import('../types.js').CustomerBillingInstruction>} */
export const decode = str => {
  try {
    const data = dagJSON.parse(str)
    return {
      ok: {
        ...data,
        from: new Date(data.from),
        to: new Date(data.from)
      }
    }
  } catch (/** @type {any} */ err) {
    return {
      error: new DecodeFailure(`decoding billing instruction message: ${err.message}`)
    }
  }
}
