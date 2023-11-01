import { Failure } from '@ucanto/server'

export class QueueOperationFailure extends Failure {
  /** @param {string} detail */
  constructor (detail) {
    super()
    this.name = /** @type {const} */ ('QueueOperationFailure')
    this.detail = detail
  }

  describe () {
    return `queue operation failed: ${this.detail}`
  }
}
