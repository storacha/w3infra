import { randomEgressEvent } from '../helpers/egress.js'
import { collectQueueMessages } from '../helpers/queue.js'

/** @type {import('./api').TestSuite<import('./api').EgressTestContext>} */
export const test = {
    'should process egress events': async (/** @type {import('entail').assert} */ assert, ctx) => {
        const maxEvents = 100
        const events = await Promise.all(
            Array.from({ length: maxEvents }, () => randomEgressEvent())
        )

        // add egress events to the queue to simulate events from the Freeway worker
        for (const e of events) {
            console.log(`Adding egress event to the queue: CustomerId: ${e.customerId}, ResourceId: ${e.resourceId}, Timestamp: ${e.timestamp.toISOString()}`)
            await ctx.egressQueue.add(e)
        }
       
        // simulate the SQS event that triggers the handler
        // FIXME (fforbeck): why the events are not collected?
        const collected = await collectQueueMessages(ctx.egressQueue)
        assert.ok(collected.ok, 'Failed to collect queue messages')
        assert.equal(collected.ok.length, events.length, 'Collected queue messages length does not match')
        
        // @type {import('aws-lambda').SQSEvent}
        const sqsEvent = {
            Records: collected.ok.map(e => ({
                // @type {import('aws-lambda').SQSRecord}
                body: JSON.stringify(e),
                messageId: Math.random().toString(),
                receiptHandle: Math.random().toString(),
                awsRegion: ctx.region,
                eventSource: 'aws:sqs',
                eventSourceARN: `arn:aws:sqs:${ctx.region}:${ctx.accountId}:${ctx.queueUrl}`,
                awsAccountId: ctx.accountId,
                md5OfBody: '',
                md5OfMessageAttributes: '',
                attributes: {
                    ApproximateReceiveCount: '1',
                    SentTimestamp: e.timestamp.getTime().toString(),
                    SenderId: ctx.accountId,
                    ApproximateFirstReceiveTimestamp: e.timestamp.getTime().toString(),
                },
                messageAttributes: {},
            }))
        }

        const response = await ctx.egressHandler(sqsEvent, ctx)
        assert.equal(response.statusCode, 200)
        assert.equal(response.body, 'Egress events processed successfully')

        // ensure we got a egress record for each event
        for (const e of events) {
            const record = await ctx.egressEventStore.list({
                customerId: e.customerId,
                resourceId: e.resourceId,
                from: e.timestamp,
            })
            assert.ok(record.ok)
            assert.equal(record.ok.results.length, 1)
            assert.equal(record.ok.results[0].customerId, e.customerId)
            assert.equal(record.ok.results[0].resourceId, e.resourceId)
            assert.equal(record.ok.results[0].timestamp, e.timestamp)
        }
        // FIXME (fforbeck): how to check we send the events to stripe?
        // we need to mock the stripe client
        // and check that the correct events are sent to stripe
    }
}
