import * as Sentry from '@sentry/serverless'

Sentry.AWSLambda.init({
  environment: process.env.SST_STAGE,
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 1.0
})

/**
 * @param {import('aws-lambda').SQSEvent} event
 */
export const _handler = (event) => {

}

export const handler = Sentry.AWSLambda.wrapHandler(_handler)

/**
 * @param {import('aws-lambda').SQSEvent} event
 * @returns {import('../types').BillingMessage}
 */
const parseBillingMessage = (event) => {

}
