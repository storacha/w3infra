import * as dagJSON from '@ipld/dag-json'
import { EncodeFailure, DecodeFailure, InvalidInput, isDIDMailto, isDID, isDIDWeb } from './lib.js'

/**
 * @typedef {import('../lib/api').SpaceBillingInstruction} SpaceBillingInstruction
 */

/** @type {import('../lib/api').Validator<SpaceBillingInstruction>} */
export const validate = input => {
  if (input == null || typeof input !== 'object') {
    return { error: new InvalidInput('not an object') }
  }
  if (!isDIDMailto(input.customer)) {
    return { error: new InvalidInput('not a DID', 'customer') }
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
  if (!(input.from instanceof Date)) {
    return { error: new InvalidInput('not a Date instance', 'from') }
  }
  if (!(input.to instanceof Date)) {
    return { error: new InvalidInput('not a Date instance', 'to') }
  }
  return { ok: {} }
}

/** @type {import('../lib/api').Encoder<SpaceBillingInstruction, string>} */
export const encode = message => {
  try {
    const data = {
      ...message,
      space: message.space,
      provider: message.provider,
      from: message.from.toISOString(),
      to: message.to.toISOString()
    }
    return { ok: dagJSON.stringify(data) }
  } catch (/** @type {any} */ err) {
    return {
      error: new EncodeFailure(`encoding space billing instruction message: ${err.message}`)
    }
  }
}

/** @type {import('../lib/api').Decoder<string, SpaceBillingInstruction>} */
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
      error: new DecodeFailure(`decoding space billing instruction message: ${err.message}`)
    }
  }
}
