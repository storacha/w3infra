export const CARPARK_EVENT_BRIDGE_SOURCE_EVENT = 'carpark_bucket'

/**
 * @typedef {{ detail: {key?: string, region: string, bucketName: string}}} EventBridgeEvent
 */

/**
 * @param {import('aws-lambda').S3Event} event
 * @param {import('@aws-sdk/client-eventbridge').EventBridge} eventBridge
 * @param {string} eventBusName
 */
 export async function notifyBus(event, eventBridge, eventBusName) {
  const entries = event.Records
    ? event.Records.map((r) => ({
        key: r?.s3?.object?.key,
        region: r?.awsRegion || 'us-west-2',
        bucketName: r?.s3?.bucket?.name,
      // only notify target subscribers for CAR files
      })).filter((entry) => entry.key && entry.key.endsWith('.car'))
    : []

  if (entries.length > 0) {
    const feedbackEntries = entries.map((entry) => ({
      EventBusName: eventBusName,
      Source: CARPARK_EVENT_BRIDGE_SOURCE_EVENT,
      DetailType: 'car_added',
      Detail: JSON.stringify(entry),
    }))
    await eventBridge.putEvents({ Entries: feedbackEntries })
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'text/plain' },
    body: `File was added to s3 bucket`,
  }
}
