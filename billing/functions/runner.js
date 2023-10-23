import * as Sentry from '@sentry/serverless'
import { notNully } from './lib.js'
import { createCustomerStore } from '../tables/customer.js'
import { createCustomerBillingQueue } from '../queues/customer.js'
import { handleCronTick } from '../lib/runner.js'

Sentry.AWSLambda.init({
  environment: process.env.SST_STAGE,
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 1.0
})

/**
 * @typedef {{
 *   customerTable?: string
 *   dbEndpoint?: URL
 *   qEndpoint?: URL
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
    const customerTable = customContext?.customerTable ?? notNully(process.env, 'CUSTOMER_TABLE_NAME')
    const dbEndpoint = new URL(customContext?.dbEndpoint ?? notNully(process.env, 'DB_ENDPOINT'))
    const qEndpoint = new URL(customContext?.qEndpoint ?? notNully(process.env, 'Q_ENDPOINT'))
    const region = customContext?.region ?? notNully(process.env, 'AWS_REGION')

    const storeOptions = { endpoint: dbEndpoint }
    const queueOptions = { endpoint: qEndpoint }

    const { error } = await handleCronTick({
      customerStore: createCustomerStore(region, customerTable, storeOptions),
      customerBillingQueue: createCustomerBillingQueue(region, queueOptions)
    })
    if (error) throw error
  }
)
