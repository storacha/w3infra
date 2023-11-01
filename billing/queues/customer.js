import { createQueueAdderClient } from './client.js'
import { encode, validate } from '../data/customer-billing-instruction.js'

/**
 * @param {{ region: string } | import('@aws-sdk/client-sqs').SQSClient} conf
 * @param {{ url: URL }} context
 */
export const createCustomerBillingQueue = (conf, { url }) =>
  createQueueAdderClient(conf, { url, encode, validate })
