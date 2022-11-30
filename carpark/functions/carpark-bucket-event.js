import { EventBridge } from '@aws-sdk/client-eventbridge'

import { notifyBus } from '../event-bus/source.js'

const EVENT_BUS_ARN = process.env.EVENT_BUS_ARN || ''

/**
 * @param {import('aws-lambda').S3Event} event
 */
async function handler(event) {
  const bus = new EventBridge({})

  return await notifyBus(event, bus, EVENT_BUS_ARN)
}

export const carparkBucketConsumer = handler
