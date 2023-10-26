import * as Sentry from '@sentry/serverless'
import { mustGetEnv } from './lib.js'
import { createCustomerStore } from '../tables/customer.js'
import { createCustomerBillingQueue } from '../queues/customer.js'
import { handleCronTick } from '../lib/billing-cron.js'

Sentry.AWSLambda.init({
  environment: process.env.SST_STAGE,
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 1.0
})

/**
 * @typedef {{
 *   customerTable?: string
 *   customerBillingQueueURL?: URL
 *   region?: 'us-west-2'|'us-east-2'
 * }} CustomHandlerContext
 */

export const handler = Sentry.AWSLambda.wrapHandler(
  /**
   * @param {import('aws-lambda').ScheduledEvent} event
   * @param {import('aws-lambda').Context} context
   */
  async (event, context) => {
    /** @type {CustomHandlerContext|undefined} */
    const customContext = context?.clientContext?.Custom
    const customerTable = customContext?.customerTable ?? mustGetEnv('CUSTOMER_TABLE_NAME')
    const customerBillingQueueURL = new URL(customContext?.customerBillingQueueURL ?? mustGetEnv('CUSTOMER_BILLING_QUEUE_URL'))
    const region = customContext?.region ?? mustGetEnv('AWS_REGION')

    const { error } = await handleCronTick({
      customerStore: createCustomerStore({ region }, { tableName: customerTable }),
      customerBillingQueue: createCustomerBillingQueue({ region }, { url: customerBillingQueueURL })
    })
    if (error) throw error
  }
)
