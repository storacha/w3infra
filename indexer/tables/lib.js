import { Failure } from '@ucanto/server'

export class StoreOperationFailure extends Failure {
  /**
   * @param {string} [message] Context for the message.
   * @param {ErrorOptions} [options]
   */
  constructor (message, options) {
    super(undefined, options)
    this.name = /** @type {const} */ ('StoreOperationFailure')
    this.detail = message
  }

  describe () {
    return `store operation failed: ${this.detail}`
  }
}
