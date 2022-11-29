import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs'

const SQS_SATNAV_WRITER_QUEUE_URL = process.env.SQS_SATNAV_WRITER_QUEUE_URL || ''
const SQS_REPLICATOR_QUEUE_REGION = 'us-west-2'

/**
 * @typedef {{ detail: {key?: string, region: string, bucketName: string}}} EventBridgeEvent
 */

/**
 * @param {EventBridgeEvent} event 
 * @param {SQSClient} client
 * @param {string} queueUrl
 */
export async function satnavWriterHandler(event, client, queueUrl) {
  const message = event?.detail

  if (message.key) {
    const data = `${message.region}/${message.bucketName}/${message.key}`
    const msgCommand = new SendMessageCommand({
      QueueUrl: queueUrl,
      MessageBody: data,
    })
    await client.send(msgCommand)
  }
}

/**
 * @param {EventBridgeEvent} event 
 */
export async function handler (event) {
  const sqsClient = new SQSClient({
    region: SQS_REPLICATOR_QUEUE_REGION,
  })

  await satnavWriterHandler(event, sqsClient, SQS_SATNAV_WRITER_QUEUE_URL)
}
