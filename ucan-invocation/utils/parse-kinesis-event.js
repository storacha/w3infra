import { toString } from 'uint8arrays/to-string'
import { fromString } from 'uint8arrays/from-string'

/**
 * @param {import('aws-lambda').KinesisStreamEvent} event
 */
export function parseKinesisEvent (event) {
  const batch = event.Records.map(r => fromString(r.kinesis.data, 'base64'))
  return batch.map(b => JSON.parse(toString(b, 'utf8')))
}
