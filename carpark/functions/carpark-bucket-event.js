import { EventBridge } from '@aws-sdk/client-eventbridge'
import * as Sentry from '@sentry/serverless'

import { notifyBus } from '../event-bus/source.js'

Sentry.AWSLambda.init({
  environment: process.env.SST_STAGE,
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 0,
})

const EVENT_BUS_ARN = process.env.EVENT_BUS_ARN || ''

/**
 * @param {import('aws-lambda').S3Event} event
 */
async function handler(event) {
  const bus = new EventBridge({})

  return await notifyBus(event, bus, EVENT_BUS_ARN)
}

export const carparkBucketConsumer = Sentry.AWSLambda.wrapHandler(handler)
