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

/** @template K */
export class RecordNotFound extends Failure {
  /**
   * @param {K} key
   */
  constructor (key) {
    super()
    this.key = key
    this.name = /** @type {const} */ ('RecordNotFound')
  }

  describe () {
    return 'record not found'
  }

  toJSON () {
    return { ...super.toJSON(), key: this.key }
  }
}

export class InsufficientRecords extends Failure {
  /**
   * @param {string} [message] Context for the message.
   * @param {ErrorOptions} [options]
   */
  constructor (message, options) {
    super(undefined, options)
    this.name = /** @type {const} */ ('InsufficientRecords')
    this.detail = message
  }

  describe () {
    return this.detail ?? 'insufficient records were provided for the operation'
  }
}
