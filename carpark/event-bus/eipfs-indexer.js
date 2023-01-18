import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs'
import * as Sentry from '@sentry/serverless'

// https://github.com/elastic-ipfs/indexer-lambda
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

  await eipfsHandler(event, sqsClient, getEnv().EIPFS_INDEXER_SQS_URL)
}

export const handler = Sentry.AWSLambda.wrapHandler(messageHandler)

/**
 * Get Env validating it is set.
 */
function getEnv() {
  return {
    EIPFS_INDEXER_SQS_URL: mustGetEnv('EIPFS_INDEXER_SQS_URL'),
  }
}

/**
 * 
 * @param {string} name 
 * @returns {string}
 */
function mustGetEnv (name) {
  if (!process.env[name]) {
    throw new Error(`Missing env var: ${name}`)
  }

  // @ts-expect-error there will always be a string there, but typescript does not believe
  return process.env[name]
}
