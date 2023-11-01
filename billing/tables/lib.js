import { Failure } from '@ucanto/server'

export class StoreOperationFailure extends Failure {
  /** @param {string} detail */
  constructor (detail) {
    super()
    this.name = /** @type {const} */ ('StoreOperationFailure')
    this.detail = detail
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
