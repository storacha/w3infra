import * as Sentry from '@sentry/serverless'
import { expect } from './lib.js'
import { decodeStr } from '../data/egress.js'
import { mustGetEnv } from '../../lib/env.js'
import { createCustomerStore } from '../tables/customer.js'
import Stripe from 'stripe'
import { Config } from 'sst/node/config'
import { recordBillingMeterEvent } from '../utils/stripe.js'
import { createEgressTrafficEventStore } from '../tables/egress-traffic.js'


Sentry.AWSLambda.init({
  environment: process.env.SST_STAGE,
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 1.0
})

/**
 * @typedef {{
 *   region?: 'us-west-2'|'us-east-2'
 *   egressTrafficQueueUrl?: string
 *   customerTable?: string
 *   billingMeterName?: string
 *   stripeSecretKey?: string
 *   customerStore?: import('../lib/api.js').CustomerStore
 *   egressTrafficTable?: string
 *   egressTrafficEventStore?: import('../lib/api.js').EgressTrafficEventStore
 * }} CustomHandlerContext
 */

/**
 * AWS Lambda handler to process egress events from the egress traffic queue.
 * Each event is a JSON object with `customer`, `resource`, `bytes` and `servedAt`.
 * The message is then deleted from the queue when successful.
 */
export const handler = Sentry.AWSLambda.wrapHandler(
  /**
   * @param {import('aws-lambda').SQSEvent} event
   * @param {import('aws-lambda').Context} context
   */
  async (event, context) => {
    /** @type {CustomHandlerContext|undefined} */
    const customContext = context?.clientContext?.Custom
    const region = customContext?.region ?? mustGetEnv('AWS_REGION')
    const customerTable = customContext?.customerTable ?? mustGetEnv('CUSTOMER_TABLE_NAME')
    const customerStore = customContext?.customerStore ?? createCustomerStore({ region }, { tableName: customerTable })
    const egressTrafficTable = customContext?.egressTrafficTable ?? mustGetEnv('EGRESS_TRAFFIC_TABLE_NAME')
    const egressTrafficEventStore = customContext?.egressTrafficEventStore ?? createEgressTrafficEventStore({ region }, { tableName: egressTrafficTable })
    
    const stripeSecretKey = customContext?.stripeSecretKey ?? Config.STRIPE_SECRET_KEY
    if (!stripeSecretKey) throw new Error('missing secret: STRIPE_SECRET_KEY')

    const billingMeterName = customContext?.billingMeterName ?? mustGetEnv('STRIPE_BILLING_METER_EVENT_NAME')
    if (!billingMeterName) throw new Error('missing secret: STRIPE_BILLING_METER_EVENT_NAME')

    const stripe = new Stripe(stripeSecretKey, { apiVersion: '2023-10-16' })
    const batchItemFailures = []
    for (const record of event.Records) {
      try {
        const decoded = decodeStr(record.body)
        const egressData = expect(decoded, 'Failed to decode egress event')

        const result = await egressTrafficEventStore.put(egressData)
        expect(result, 'Failed to save egress event in database')

        const response = await customerStore.get({ customer: egressData.customer })
        if (response.error) throw response.error

        const customerAccount = response.ok.account
        expect(
          await recordBillingMeterEvent(stripe, billingMeterName, egressData, customerAccount),
          `Failed to record egress event in Stripe API for customer: ${egressData.customer}, account: ${customerAccount}, bytes: ${egressData.bytes}, servedAt: ${egressData.servedAt.toISOString()}, resource: ${egressData.resource}`
        )
      } catch (error) {
        console.error('Error processing egress event:', error)
        batchItemFailures.push({ itemIdentifier: record.messageId })
      }
    }

    return {
      statusCode: 200,
      body: 'Egress events processed successfully',
      // Return the failed records so they can be retried
      batchItemFailures
    }
  },
)