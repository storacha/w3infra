import * as Sentry from '@sentry/serverless'
import { expect } from './lib.js'
import { decode } from '../data/egress.js'
import { SQSClient, DeleteMessageCommand } from '@aws-sdk/client-sqs'
import { mustGetEnv } from '../../lib/env.js'
import { createCustomerStore } from '../tables/customer.js'
import Stripe from 'stripe'
import { Config } from 'sst/node/config'

Sentry.AWSLambda.init({
    environment: process.env.SST_STAGE,
    dsn: process.env.SENTRY_DSN,
    tracesSampleRate: 1.0
})

/**
 * @typedef {{
 *   region?: 'us-west-2'|'us-east-2'
 *   queueUrl?: string
 *   customerTable?: string
 *   billingMeterName?: string
 *   stripeSecretKey?: string
 * }} CustomHandlerContext
 */

/**
 * AWS Lambda handler to process egress events from the egress traffic queue.
 * Each event is a JSON object with `customer`, `resource`, `bytes` and `timestamp`.
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
        const queueUrl = customContext?.queueUrl ?? mustGetEnv('EGRESS_TRAFFIC_QUEUE_URL')
        const customerTable = customContext?.customerTable ?? mustGetEnv('CUSTOMER_TABLE_NAME')
        const sqsClient = new SQSClient({ region })
        const customerStore = createCustomerStore({ region }, { tableName: customerTable })
        const billingMeterName = customContext?.billingMeterName ?? 'gateway_egress_traffic'
        const stripeSecretKey = customContext?.stripeSecretKey ?? Config.STRIPE_SECRET_KEY

        if (!stripeSecretKey) throw new Error('missing secret: STRIPE_SECRET_KEY')
        const stripe = new Stripe(stripeSecretKey, { apiVersion: '2023-10-16' })

        for (const record of event.Records) {
            try {
                const messageBody = JSON.parse(record.body)
                const decoded = decode(messageBody)
                const egressEvent = expect(decoded, 'Failed to decode egress message')

                expect(
                    await recordEgress(customerStore, stripe, billingMeterName, egressEvent),
                    `Failed to send record usage to Stripe for customer: ${egressEvent.customer}, resource: ${egressEvent.resource}, servedAt: ${egressEvent.servedAt.toISOString()}`
                )

                /**
                 * SQS requires explicit acknowledgment that a message has been successfully processed.
                 * This is done by deleting the message from the queue using its ReceiptHandle
                 */
                await sqsClient.send(new DeleteMessageCommand({
                    QueueUrl: queueUrl,
                    ReceiptHandle: record.receiptHandle
                }))
            } catch (error) {
                console.error('Error processing egress event:', error)
            }
        }

        return {
            statusCode: 200,
            body: 'Egress events processed successfully'
        }
    },
)

/**
 * Finds the Stripe customer ID for the given customer and records the egress traffic data in the Stripe Billing Meter API.
 * 
 * @param {import('../lib/api.ts').CustomerStore} customerStore
 * @param {import('stripe').Stripe} stripe
 * @param {string} billingMeterName
 * @param {import('../lib/api.ts').EgressTrafficData} egressEventData
 */
async function recordEgress(customerStore, stripe, billingMeterName, egressEventData) {
    const response = await customerStore.get({ customer: egressEventData.customer })
    if (response.error) {
        return {
            error: {
                name: 'CustomerNotFound',
                message: `Error getting customer ${egressEventData.customer}`,
                cause: response.error
            }
        }
    }
    const stripeCustomerId = response.ok.account.slice('stripe:'.length)
    /** @type {import('stripe').Stripe.Customer | import('stripe').Stripe.DeletedCustomer} */
    const stripeCustomer = await stripe.customers.retrieve(stripeCustomerId)
    if (stripeCustomer.deleted) {
        return {
            error: {
                name: 'StripeCustomerNotFound',
                message: `Customer ${stripeCustomerId} has been deleted from Stripe`,
            }
        }
    }

    /** @type {import('stripe').Stripe.Billing.MeterEvent} */
    const meterEvent = await stripe.billing.meterEvents.create({
        event_name: billingMeterName,
        payload: {
            stripe_customer_id: stripeCustomerId,
            value: egressEventData.bytes.toString(),
        },
        timestamp: Math.floor(egressEventData.servedAt.getTime() / 1000)
    })
    if (meterEvent.identifier) {
        return { ok: { meterEvent } }
    }
    return {
        error: {
            name: 'StripeBillingMeterEventCreationFailed',
            message: `Error creating meter event for egress traffic in Stripe for customer ${egressEventData.customer} @ ${egressEventData.servedAt.toISOString()}`,
        }
    }
}