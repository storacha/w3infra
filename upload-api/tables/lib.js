import { Failure } from '@ucanto/server'

export class RecordNotFound extends Failure {
  constructor () {
    super()
    this.name = /** @type {const} */ ('RecordNotFound')
  }

  describe () {
    return 'record not found'
  }
}

export class RecordKeyConflict extends Failure {
  constructor () {
    super()
    this.name = /** @type {const} */ ('RecordKeyConflict')
  }

  describe () {
    return 'record key conflict'
  }
}
