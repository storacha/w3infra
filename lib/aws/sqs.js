import { SQSClient } from '@aws-sdk/client-sqs'

/** @type {Record<string, import('@aws-sdk/client-sqs').SQSClient>} */
const sqsClients = {}

/** @param {{ region: string }} config */
export function getSQSClient (config) {
  if (!sqsClients[config.region]) {
    sqsClients[config.region] = new SQSClient(config)
  }
  return sqsClients[config.region]
}
