import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs'
import { QueueOperationFailure } from './lib.js'

/** @param {{ region: string } | SQSClient} target */
export const connectQueue = target =>
  target instanceof SQSClient
    ? target
    : new SQSClient(target)

/**
 * @template T
 * @param {{ region: string } | import('@aws-sdk/client-sqs').SQSClient} conf
 * @param {object} context
 * @param {URL} [context.endpoint]
 * @param {import('../types').Validator<T>} context.validate
 * @param {import('../types').Encoder<T, string>} context.encode
 * @returns {import('../types').Queue<T>}
 */
export function createQueueClient (conf, context) {
  const client = connectQueue(conf)
  return {
    async add (message, options = {}) {
      const validation = context.validate(message)
      if (validation.error) return validation

      const encoding = context.encode(message)
      if (encoding.error) return encoding

      const cmd = new SendMessageCommand({
        QueueUrl: context.endpoint?.toString(),
        MessageBody: encoding.ok
        // MessageGroupId: options.messageGroupId
      })

      try {
        const res = await client.send(cmd)
        if (res.$metadata.httpStatusCode !== 200) {
          throw new Error(`unexpected status sending message to queue: ${res.$metadata.httpStatusCode}`)
        }
      } catch (/** @type {any} */ err) {
        return { error: new QueueOperationFailure(err.message) }
      }

      return { ok: {} }
    }
  }
}
