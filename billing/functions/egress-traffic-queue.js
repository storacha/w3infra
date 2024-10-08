import * as Sentry from '@sentry/serverless'
import { expect } from './lib.js'
import { createEgressEventStore } from '../tables/egress.js'
import { decode } from '../data/egress.js'
import { SQSClient, DeleteMessageCommand } from '@aws-sdk/client-sqs'
import { mustGetEnv } from '../../lib/env.js'

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

        for (const record of event.Records) {
            try {
                const messageBody = JSON.parse(record.body)
                const decoded = decode(messageBody)
                const egressEvent = expect(decoded, 'Failed to decode egress message')

                expect(
                    await egressEventStore.put(egressEvent),
                    `Failed to store egress event for customerId: ${egressEvent.customerId}, resourceId: ${egressEvent.resourceId}, timestamp: ${egressEvent.timestamp.toISOString()}`
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
    })
