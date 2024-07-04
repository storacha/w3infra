import { Failure } from '@ucanto/server'
import { SQSClient } from '@aws-sdk/client-sqs'

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

/** @type {Record<string, import('@aws-sdk/client-sqs').SQSClient>} */
const sqsClients = {}

/** @param {string} region */
export function getSQSClient (region) {
  if (!sqsClients[region]) {
    sqsClients[region] = new SQSClient({ region })
  }
  return sqsClients[region]
}
