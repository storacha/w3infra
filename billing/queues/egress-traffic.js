import { createQueueAdderClient } from './client.js'
import { encode, validate } from '../data/egress.js'

/**
 * @param {{ region: string } | import('@aws-sdk/client-sqs').SQSClient} conf
 * @param {{ url: URL }} context
 */
export const createEgressTrafficQueue = (conf, { url }) =>
  createQueueAdderClient(conf, { url, encode, validate })
