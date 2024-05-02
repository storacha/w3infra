import { ReceiveMessageCommand, DeleteMessageCommand } from '@aws-sdk/client-sqs'
import retry from 'p-retry'

/**
 * @param {import('@aws-sdk/client-sqs').SQSClient} client
 * @param {URL} url
 */
export const collectQueueMessages = async (client, url) => {
  const messages = []

  while (true) {
    const cmd = new ReceiveMessageCommand({
      QueueUrl: url.toString(),
      MaxNumberOfMessages: 10
    })

    const res = await retry(async () => {
      const res = await client.send(cmd)
      if (res.$metadata.httpStatusCode !== 200) {
        throw new Error(`unexpected status receiving message from queue: ${res.$metadata.httpStatusCode}`)
      }
      return res
    }, {
      retries: 3,
      minTimeout: 100,
      onFailedAttempt: console.warn
    })

    if (!res.Messages || !res.Messages.length) {
      break
    }

    for (const m of res.Messages) {
      if (!m.Body) continue
      messages.push(m.Body)

      await retry(async () => {
        const cmd = new DeleteMessageCommand({
          QueueUrl: url.toString(),
          ReceiptHandle: m.ReceiptHandle
        })
        const res = await client.send(cmd)
        if (res.$metadata.httpStatusCode !== 200) {
          throw new Error(`unexpected status deleting message from queue: ${res.$metadata.httpStatusCode}`)
        }
      }, {
        retries: 3,
        minTimeout: 100,
        onFailedAttempt: console.warn
      })
    }
  }

  return messages
}