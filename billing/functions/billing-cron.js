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
   * @param {import('aws-lambda').ScheduledEvent|import('aws-lambda').APIGatewayProxyEventV2} event
   * @param {import('aws-lambda').Context} context
   */
  async (event, context) => {
    /** @type {CustomHandlerContext|undefined} */
    const customContext = context?.clientContext?.Custom
    const customerTable = customContext?.customerTable ?? mustGetEnv('CUSTOMER_TABLE_NAME')
    const customerBillingQueueURL = new URL(customContext?.customerBillingQueueURL ?? mustGetEnv('CUSTOMER_BILLING_QUEUE_URL'))
    const region = customContext?.region ?? mustGetEnv('AWS_REGION')

    let options
    if ('rawQueryString' in event) {
      const { searchParams } = new URL(`http://localhost/?${event.rawQueryString}`)
      const fromParam = searchParams.get('from')
      const toParam = searchParams.get('to')
      if (fromParam && toParam) {
        const from = new Date(fromParam)
        if (!isValidDate(from)) {
          throw new Error('invalid from date')
        }
        const to = new Date(toParam)
        if (!isValidDate(to)) {
          throw new Error('invalid from date')
        }
        if (from.getTime() <= to.getTime()) {
          throw new Error('from date must be less than to date')
        }
        options = { period: { from, to } }
      }
    }

    const { error } = await handleCronTick({
      customerStore: createCustomerStore({ region }, { tableName: customerTable }),
      customerBillingQueue: createCustomerBillingQueue({ region }, { url: customerBillingQueueURL })
    }, options)
    if (error) throw error
  }
)

/** @param {Date} d */
const isValidDate = d => !isNaN(d.getTime())
