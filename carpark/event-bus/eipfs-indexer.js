import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs'
import * as Sentry from '@sentry/serverless'

// https://github.com/elastic-ipfs/indexer-lambda
const SQS_INDEXER_QUEUE_URL =
  'https://sqs.us-west-2.amazonaws.com/505595374361/indexer-topic'
const SQS_INDEXER_QUEUE_REGION = 'us-west-2'

Sentry.AWSLambda.init({
  environment: process.env.SST_STAGE,
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 1.0,
})

/**
 * @param {import('./source').EventBridgeEvent} event 
 * @param {SQSClient} client
 * @param {string} queueUrl
 */
export async function eipfsHandler(event, client, queueUrl) {
  const message = event?.detail

  if (message.key) {
    const data = `${message.region}/${message.bucketName}/${message.key}`
    const msgCommand = new SendMessageCommand({
      QueueUrl: queueUrl,
      MessageBody: data
    })
    await client.send(msgCommand)
  }
}

/**
 * @param {import('./source').EventBridgeEvent} event 
 */
async function messageHandler (event) {
  const sqsClient = new SQSClient({
    region: SQS_INDEXER_QUEUE_REGION,
  })

  await eipfsHandler(event, sqsClient, SQS_INDEXER_QUEUE_URL)
}

export const handler = Sentry.AWSLambda.wrapHandler(messageHandler)
