import { createQueueBatchAdderClient } from './client.js'
import { encode } from '../data/multihashes.js'

/**
 * @param {{ region: string } | import('@aws-sdk/client-sqs').SQSClient} conf
 * @param {{ url: URL }} context
 */
export const createMultihashesQueue = (conf, { url }) =>
  createQueueBatchAdderClient(conf, { url, encode })
