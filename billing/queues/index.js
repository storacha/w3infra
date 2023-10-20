import { SQSClient } from '@aws-sdk/client-sqs'

/** @param {{ region: string } | SQSClient} target */
export const connectQueue = target =>
  target instanceof SQSClient
    ? target
    : new SQSClient(target)
