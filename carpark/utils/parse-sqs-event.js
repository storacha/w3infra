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

  const carId = sqsEvent.Records[0].body
  const info = carId.match(/([^/]+)\/([^/]+)\/(.+)/)
  if (!info) {
    return
  }

  const [, bucketRegion, bucketName, key] = info

  return {
    bucketRegion,
    bucketName,
    key,
  }
}
