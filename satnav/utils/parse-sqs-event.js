/**
 * @typedef {object} EventRecord
 * @property {string} bucketRegion
 * @property {string} bucketName
 * @property {string} key
 */

/**
 * Extract an EventRecord from the passed SQS Event
 *
 * @param {import('aws-lambda').SQSEvent} sqsEvent
 * @returns {EventRecord | undefined}
 */
 export default function parseEvent(sqsEvent) {
  if (sqsEvent.Records.length !== 1) {
    throw new Error(
      `Expected 1 CAR per invocation but received ${sqsEvent.Records.length} CARs`
    )
  }

  const body = sqsEvent.Records[0].body
  if (!body) {
    return
  }
  const { key, region, bucket } = JSON.parse(body)

  return {
    bucketRegion: region,
    bucketName: bucket,
    key,
  }
}
