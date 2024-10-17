import { randomEgressEvent } from '../helpers/egress.js'

/** @type {import('./api').TestSuite<import('./api').EgressTrafficTestContext>} */
export const test = {
    'should process egress events': async (/** @type {import('entail').assert} */ assert, ctx) => {
        const maxEvents = 100
        const events = await Promise.all(
            Array.from({ length: maxEvents }, () => randomEgressEvent())
        )

        // 1. Add egress events to the queue to simulate events from the Freeway worker
        for (const e of events) {
            console.log(`Adding egress event to the queue: CustomerId: ${e.customer}, ResourceId: ${e.resource}, ServedAt: ${e.servedAt.toISOString()}`)
            await ctx.egressTrafficQueue.add(e)
        }


        // 2. Create a SQS event batch
        // @type {import('aws-lambda').SQSEvent}
        const sqsEventBatch = {
            Records: events.map(e => ({
                // @type {import('aws-lambda').SQSRecord}
                body: JSON.stringify(e),
                messageId: Math.random().toString(),
                receiptHandle: Math.random().toString(),
                awsRegion: ctx.region,
                eventSource: 'aws:sqs',
                eventSourceARN: `arn:aws:sqs:${ctx.region}:${ctx.accountId}:${ctx.egressTrafficQueueUrl}`,
                awsAccountId: ctx.accountId,
                md5OfBody: '',
                md5OfMessageAttributes: '',
                attributes: {
                    ApproximateReceiveCount: '1',
                    SentTimestamp: e.servedAt.getTime().toString(),
                    SenderId: ctx.accountId,
                    ApproximateFirstReceiveTimestamp: e.servedAt.getTime().toString(),
                },
                messageAttributes: {},
            }))
        }

        // 3. Process the SQS event to trigger the handler
        await ctx.egressTrafficHandler(sqsEventBatch, ctx, (err, res) => {
            if (err) {
                assert.fail(err)
            }
            assert.ok(res)
            assert.equal(res.statusCode, 200)
            assert.equal(res.body, 'Egress events processed successfully')
        })

        // 4. Ensure we got a billing meter event or each egress event in the queue
        // query stripe for the billing meter events
        // const billingMeterEvents = await ctx.stripe.billing.meterEvents.list({
        //     limit: maxEvents,
        // })
        // assert.equal(billingMeterEvents.data.length, events.length)
        // FIXME (fforbeck): how to check we send the events to stripe?
        // we need to mock the stripe client
        // and check that the correct events are sent to stripe
    }
}