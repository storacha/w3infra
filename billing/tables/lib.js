import { Failure } from '@ucanto/server'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'

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

/** @type {Record<string, import('@aws-sdk/client-dynamodb').DynamoDBClient>} */
const dynamoClients = {}

/** @param {string} region */
export function getDynamoClient (region) {
  if (!dynamoClients[region]) {
    dynamoClients[region] = new DynamoDBClient({ region })
  }
  return dynamoClients[region]
}
