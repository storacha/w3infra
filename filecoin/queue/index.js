import { SQSClient } from '@aws-sdk/client-sqs'

/**
 * @param {import('./types.js').QueueConnect | SQSClient} target 
 */
export function connectQueue (target) {
  if (target instanceof SQSClient) {
    return target
  }
  return new SQSClient(target)
}
