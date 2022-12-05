import { EventBridge } from '@aws-sdk/client-eventbridge'
import * as Sentry from '@sentry/serverless'

import { notifyBus } from '../event-bus/source.js'

Sentry.AWSLambda.init({
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 1.0,
})

const EVENT_BUS_ARN = process.env.EVENT_BUS_ARN || ''

/**
 * @param {import('aws-lambda').S3Event} event
 */
async function handler(event) {
  const bus = new EventBridge({})

  return await notifyBus(event, bus, EVENT_BUS_ARN)
}

export const satnavBucketConsumer = Sentry.AWSLambda.wrapHandler(handler)
