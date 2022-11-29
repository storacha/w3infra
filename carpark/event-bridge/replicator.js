import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs'

const SQS_REPLICATOR_QUEUE_URL = process.env.SQS_REPLICATOR_QUEUE_URL || ''
const SQS_REPLICATOR_QUEUE_REGION = 'us-west-2'

/**
 * @param {import('.').EventBridgeEvent} event 
 * @param {SQSClient} client
 * @param {string} queueUrl
 */
export async function replicatorHandler(event, client, queueUrl) {
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
 * @param {import('.').EventBridgeEvent} event 
 */
export async function handler (event) {
  const sqsClient = new SQSClient({
    region: SQS_REPLICATOR_QUEUE_REGION,
  })

  await replicatorHandler(event, sqsClient, SQS_REPLICATOR_QUEUE_URL)
}
