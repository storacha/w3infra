import * as Sentry from '@sentry/serverless'
import { expect } from './lib.js'
import { decodeStr } from '../data/egress.js'
import { extractMonth } from '../data/egress-monthly.js'
import { mustGetEnv } from '../../lib/env.js'
import { createCustomerStore } from '../tables/customer.js'
import Stripe from 'stripe'
import { Config } from 'sst/node/config'
import { recordBillingMeterEvent } from '../utils/stripe.js'
import { createEgressTrafficEventStore } from '../tables/egress-traffic.js'
import { createEgressTrafficMonthlyStore } from '../tables/egress-traffic-monthly.js'

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
 *   egressTrafficMonthlyTable?: string
 *   egressTrafficMonthlyStore?:  import('../lib/api.js').EgressTrafficMonthlyStore
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
    const egressTrafficMonthlyTable = customContext?.egressTrafficMonthlyTable ?? mustGetEnv('EGRESS_TRAFFIC_MONTHLY_TABLE_NAME')
    const egressTrafficEventStore = customContext?.egressTrafficEventStore ?? createEgressTrafficEventStore({ region }, { tableName: egressTrafficTable })
    const egressTrafficMonthlyStore = customContext?.egressTrafficMonthlyStore ?? createEgressTrafficMonthlyStore({ region }, { tableName: egressTrafficMonthlyTable })
    const skipStripeEgressTracking = (process.env.SKIP_STRIPE_EGRESS_TRACKING === 'true')

    const stripeSecretKey = customContext?.stripeSecretKey ?? Config.STRIPE_SECRET_KEY
    if (!stripeSecretKey) throw new Error('missing secret: STRIPE_SECRET_KEY')

    const billingMeterName = customContext?.billingMeterName ?? mustGetEnv('STRIPE_BILLING_METER_EVENT_NAME')
    if (!billingMeterName) throw new Error('missing secret: STRIPE_BILLING_METER_EVENT_NAME')

    const stripe = new Stripe(stripeSecretKey, { apiVersion: '2025-02-24.acacia' })
    const batchItemFailures = []
    for (const record of event.Records) {
      try {
        const receiveCount = record.attributes?.ApproximateReceiveCount || '1'                                                                                                                                    
                                                                                                                                                                                                              
        console.log('SQS message received:', {                                                                                                                                                                    
          messageId: record.messageId,                                                                                                                                                                            
          receiveCount,                                                                                                                                                                                           
          body: record.body  // Contains the egress event                                                                                                                                                         
        })   

        const decoded = decodeStr(record.body)
        const egressData = expect(decoded, 'Failed to decode egress event')

        // Extract month for monthly aggregation
        const month = extractMonth(egressData.servedAt)

        // IMPORTANT: Duplicate/retry event handling
        // Uses ConditionExpression to prevent overwriting existing events.
        //
        // Behavior on duplicate SQS messages:
        //   - put() fails with ConditionalCheckFailedException (event exists)
        //   - Skip monthly increment to prevent over-counting
        //   - Still call Stripe (idempotent via idempotency key) since this can be a retry and not duplication
        //
        // Trade-off: If increment fails on first attempt and message retries,
        // the event will be saved and billed but NOT counted in monthly aggregates.
        // This is acceptable because:
        //   - Increment failures are extremely rare (empty DLQ, no recent errors)
        //   - Stripe report is idempotent
        //   - Monthly aggregates are for reporting only
        //
        const putResult = await egressTrafficEventStore.put(egressData, { conditionFieldsMustNotExist: ['pk', 'sk'] })

        let isDuplicate = false
        if (putResult.error) {
          // @ts-expect-error - cause.name exists on AWS SDK errors
          if (putResult.error.cause?.name === 'ConditionalCheckFailedException') {
            console.log(`Duplicate event detected for customer ${egressData.customer}, space ${egressData.space} at ${egressData.servedAt.toISOString()} - skipping increment`)
            isDuplicate = true
          } else {
            expect(putResult, 'Failed to save egress event in database')
          }
        }

        // Get customer account for Stripe billing
        const response = await customerStore.get({ customer: egressData.customer })
        if (response.error) throw response.error

        const customerAccount = response.ok.account
        if (customerAccount) {
          if (!skipStripeEgressTracking) {
            expect(
              await recordBillingMeterEvent(stripe, billingMeterName, egressData, customerAccount),
              `Failed to record egress event in Stripe API for customer: ${egressData.customer}, account: ${customerAccount}, bytes: ${egressData.bytes}, servedAt: ${egressData.servedAt.toISOString()}, resource: ${egressData.resource}`
            )
          } else {
            console.warn('Stripe egress reporting feature flagged off, skipping Stripe API call.')
          }
        } else {
          console.warn(`Received egress event but could not find ${egressData.customer} in our database - this is very strange!`)
        }

        if (!isDuplicate) {
          // Increment monthly aggregate (only for new events)
          const incrementResult = await egressTrafficMonthlyStore.increment({
            customer: egressData.customer,
            space: egressData.space,
            month,
            bytes: egressData.bytes
          })
          expect(incrementResult, 'Failed to increment monthly egress aggregates')
        }
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