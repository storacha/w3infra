import { DID, Failure } from '@ucanto/server'

export class InvalidInput extends Failure {
  /**
   * @param {string} [message] Additional context for the message.
   * @param {string} [field] Field that was invalid.
   */
  constructor (message, field) {
    super()
    this.detail = message
    this.field = field
    this.name = /** @type {const} */ ('InvalidInput')
  }

  describe () {
    const detail = this.detail ? `: ${this.detail}` : ''
    return this.field
      ? `invalid input${detail}`
      : `invalid value for "${this.field}"${detail}`
  }

  toJSON () {
    return { ...super.toJSON(), field: this.field }
  }
}

export class DecodeFailure extends Failure {
  /** @param {string} [message] Context for the message. */
  constructor (message) {
    super()
    this.name = /** @type {const} */ ('DecodeFailure')
    this.detail = message
  }

  describe () {
    const detail = this.detail ? `: ${this.detail}` : ''
    return `decode failed${detail}`
  }
}

export class EncodeFailure extends Failure {
  /** @param {string} [message] Context for the message. */
  constructor (message) {
    super()
    this.name = /** @type {const} */ ('EncodeFailure')
    this.detail = message
  }

  describe () {
    const detail = this.detail ? `: ${this.detail}` : ''
    return `encode failed${detail}`
  }
}

/**
 * @param {any} input
 * @returns {input is import('@ucanto/interface').DID}
 */
export const isDID = input => {
  if (typeof input !== 'string') return false
  try {
    DID.parse(input)
    return true
  } catch {
    return false
  }
}

/**
 * @param {any} input
 * @returns {input is import('@ucanto/interface').DID<'mailto'>}
 */
export const isDIDMailto = input => isDID(input) && input.startsWith('did:mailto')

/** @param {any} input */
export const asDID = input => {
  if (!isDID(input)) throw new Error('not a DID')
  return input
}

/** @param {any} input */
export const asDIDMailto = input => {
  if (!isDIDMailto(input)) throw new Error('not a mailto DID')
  return input
}
