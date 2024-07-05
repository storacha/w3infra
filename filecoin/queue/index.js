import { SQSClient } from '@aws-sdk/client-sqs'
import { getSQSClient } from '../../lib/aws/sqs.js'

/**
 * @param {import('./types.js').QueueConnect | SQSClient} target 
 */
export function connectQueue (target) {
  if (target instanceof SQSClient) {
    return target
  }
  return getSQSClient(target)
}
