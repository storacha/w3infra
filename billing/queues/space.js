import { createQueueAdderClient } from './client.js'
import { encode, validate } from '../data/space-billing-instruction.js'

/**
 * @param {{ region: string } | import('@aws-sdk/client-sqs').SQSClient} conf
 * @param {{ url: URL }} context
 */
export const createSpaceBillingQueue = (conf, { url }) =>
  createQueueAdderClient(conf, { url, encode, validate })
