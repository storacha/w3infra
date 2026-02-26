 import * as Sentry from '@sentry/serverless'
import { DynamoDBClient, TransactWriteItemsCommand } from '@aws-sdk/client-dynamodb'
import { marshall } from '@aws-sdk/util-dynamodb'
import { expect } from './lib.js'
import { decodeStr, encode } from '../data/egress.js'
import { extractMonth } from '../data/egress-monthly.js'
import { mustGetEnv } from '../../lib/env.js'
import { createCustomerStore } from '../tables/customer.js'
import Stripe from 'stripe'
import { Config } from 'sst/node/config'
import { recordBillingMeterEvent } from '../utils/stripe.js'


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
 *   egressTrafficMonthlyTable?: string
 *   dynamoClient?: import('@aws-sdk/client-dynamodb').DynamoDBClient
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
    const dynamoClient = customContext?.dynamoClient ?? new DynamoDBClient({ region })
    const skipStripeEgressTracking = (process.env.SKIP_STRIPE_EGRESS_TRACKING === 'true')

    const stripeSecretKey = customContext?.stripeSecretKey ?? Config.STRIPE_SECRET_KEY
    if (!stripeSecretKey) throw new Error('missing secret: STRIPE_SECRET_KEY')

    const billingMeterName = customContext?.billingMeterName ?? mustGetEnv('STRIPE_BILLING_METER_EVENT_NAME')
    if (!billingMeterName) throw new Error('missing secret: STRIPE_BILLING_METER_EVENT_NAME')

    const stripe = new Stripe(stripeSecretKey, { apiVersion: '2025-02-24.acacia' })
    const batchItemFailures = []
    for (const record of event.Records) {
      try {
        const decoded = decodeStr(record.body)
        const egressData = expect(decoded, 'Failed to decode egress event')

        // Extract month for monthly aggregation
        const month = extractMonth(egressData.servedAt)
        const encodedEvent = encode(egressData)
        expect(encodedEvent, 'Failed to encode egress event')

        // Atomic transaction: write raw event + increment monthly counter
        // If raw event already exists, entire transaction fails (idempotent)
        try {
          await dynamoClient.send(new TransactWriteItemsCommand({
            TransactItems: [
              {
                // Write raw event (with condition: must not already exist)
                Put: {
                  TableName: egressTrafficTable,
                  Item: marshall(encodedEvent.ok),
                  ConditionExpression: 'attribute_not_exists(pk)',
                }
              },
              {
                // Increment monthly aggregate (only if raw event write succeeds)
                Update: {
                  TableName: egressTrafficMonthlyTable,
                  Key: marshall({
                    pk: `customer#${egressData.customer}`,
                    sk: `${month}#${egressData.space}`
                  }),
                  UpdateExpression: 'SET space = :space, #month = :month ADD bytes :bytes, eventCount :one',
                  ExpressionAttributeNames: {
                    '#month': 'month'
                  },
                  ExpressionAttributeValues: marshall({
                    ':space': egressData.space,
                    ':month': month,
                    ':bytes': egressData.bytes,
                    ':one': 1
                  })
                }
              }
            ]
          }))
        } catch (/** @type {any} */ err) {
          // Check if failure is due to duplicate event (ConditionalCheckFailedException)
          if (err.name === 'TransactionCanceledException' &&
              err.CancellationReasons?.[0]?.Code === 'ConditionalCheckFailed') {
            // Event already processed - this is a retry, skip silently
            console.log('Duplicate event detected, skipping', {
              customer: egressData.customer,
              space: egressData.space,
              cause: egressData.cause.toString()
            })
            continue // Success - don't add to batchItemFailures
          }

          // Actual error - rethrow for retry
          console.error('Failed to write egress event', {
            customer: egressData.customer,
            error: err.message
          })
          throw err
        }

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