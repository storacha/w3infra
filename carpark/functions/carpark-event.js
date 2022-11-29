import { EventBridge } from '@aws-sdk/client-eventbridge'

import { notifyBusNewCar } from '../event-bridge/index.js'

const CARPARK_BUS_ARN = process.env.CARPARK_BUS_ARN || ''

/**
 * @param {import('aws-lambda').S3Event} event
 */
async function handler(event) {
  const bus = new EventBridge({})

  return await notifyBusNewCar(event, bus, CARPARK_BUS_ARN)
}

export const carparkBucketConsumer = handler
