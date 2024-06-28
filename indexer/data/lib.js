import { Failure } from '@ucanto/server'

export class EncodeFailure extends Failure {
  /**
   * @param {string} [message] Context for the message.
   * @param {ErrorOptions} [options]
   */
  constructor (message, options) {
    super(undefined, options)
    this.name = /** @type {const} */ ('EncodeFailure')
    this.detail = message
  }

  describe () {
    const detail = this.detail ? `: ${this.detail}` : ''
    return `encode failed${detail}`
  }
}
