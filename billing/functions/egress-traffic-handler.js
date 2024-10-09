import * as Sentry from '@sentry/serverless'
import { Config } from 'sst/node/config'
import { expect } from './lib.js'
import { createEgressEventStore } from '../tables/egress.js'
import { decode } from '../data/egress.js'
import { SQSClient, DeleteMessageCommand } from '@aws-sdk/client-sqs'
import { mustGetEnv } from '../../lib/env.js'
import Stripe from 'stripe'

Sentry.AWSLambda.init({
    environment: process.env.SST_STAGE,
    dsn: process.env.SENTRY_DSN,
    tracesSampleRate: 1.0
})

/**
 * @typedef {{
 *   egressTable?: string
 *   queueUrl?: string
 *   region?: 'us-west-2'|'us-east-2'
 *   stripeSecretKey?: string
 * }} CustomHandlerContext
 */

/**
 * AWS Lambda handler to process egress events from the egress traffic queue.
 * Each event is a JSON object with a `customerId`, `resourceId` and `timestamp`.
 * The event is decoded and stored in the egress event table.
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
        const egressTable = customContext?.egressTable ?? mustGetEnv('EGRESS_TABLE_NAME')
        const queueUrl = customContext?.queueUrl ?? mustGetEnv('EGRESS_TRAFFIC_QUEUE_URL')
        const sqsClient = new SQSClient({ region })
        const egressEventStore = createEgressEventStore({ region }, { tableName: egressTable })
        const stripeSecretKey = customContext?.stripeSecretKey ?? Config.STRIPE_SECRET_KEY

        if (!stripeSecretKey) throw new Error('missing secret: STRIPE_SECRET_KEY')
        const stripe = new Stripe(stripeSecretKey, { apiVersion: '2023-10-16' })

        for (const record of event.Records) {
            try {
                const messageBody = JSON.parse(record.body)
                const decoded = decode(messageBody)
                const egressEvent = expect(decoded, 'Failed to decode egress message')

                expect(
                    await egressEventStore.put(egressEvent),
                    `Failed to store egress event for customerId: ${egressEvent.customerId}, resourceId: ${egressEvent.resourceId}, timestamp: ${egressEvent.timestamp.toISOString()}`
                )

                expect(
                    await sendRecordUsageToStripe(stripe, egressEvent),
                    `Failed to send record usage to Stripe for customerId: ${egressEvent.customerId}, resourceId: ${egressEvent.resourceId}, timestamp: ${egressEvent.timestamp.toISOString()}`
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
    })

/**
 * Sends a record usage to Stripe for a given egress event.
 * It uses the Stripe API v2023-10-16 to create a usage record for the given subscription item and quantity.
 * The response is checked to ensure the usage record was created successfully.
 * 
 * @param {import('stripe').Stripe} stripe
 * @param {import('../data/egress.js').EgressEvent} egressEvent
 * @returns {Promise<import('@ucanto/interface').Result<boolean, Error>>}
 */
async function sendRecordUsageToStripe(stripe, egressEvent) {
    const subscriptionItem = {
        id: 'sub_123', // FIXME (fforbeck): 
        // Where do we get this from?
        // Should be in the event?
        // Should we find it in the Stripe API using the customerId?
    }
    const response = await stripe.subscriptionItems.createUsageRecord(
        subscriptionItem.id,
        {
            quantity: 1, // always 1 for each egress event
            timestamp: egressEvent.timestamp.getTime()
        }
    )
    if (response.object === 'usage_record') {
        return { ok: true }
    }
    return { error: new Error('Failed to send record usage to Stripe') }
}
