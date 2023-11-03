import { Failure } from '@ucanto/server'

export class QueueOperationFailure extends Failure {
  /**
   * @param {string} [message] Context for the message.
   * @param {ErrorOptions} [options]
   */
  constructor (message, options) {
    super(undefined, options)
    this.name = /** @type {const} */ ('QueueOperationFailure')
    this.detail = message
  }

  describe () {
    return `queue operation failed: ${this.detail}`
  }
}
