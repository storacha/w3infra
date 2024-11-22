import * as Sentry from '@sentry/serverless'
import * as dagJSON from '@ipld/dag-json'
import * as Digest from 'multiformats/hashes/digest'
import { publishBlockAdvertisement } from '../lib/block-advert-publisher.js'
import { createMultihashesQueue } from '../queues/multihashes.js'
import { mustGetEnv } from '../../lib/env.js'
import { getSQSClient } from '../../lib/aws/sqs.js'

Sentry.AWSLambda.init({
  environment: process.env.SST_STAGE,
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 0,
})

/**
 * @param {import('aws-lambda').SQSEvent} sqsEvent
 */
const handleBlockAdvertPublishMessage = async (sqsEvent) => {
  if (sqsEvent.Records.length !== 1) {
    return {
      statusCode: 400,
      body: `Expected 1 SQS message per invocation but received ${sqsEvent.Records.length}`
    }
  }

  const advert = decodeMessage(sqsEvent.Records[0].body)
  const url = new URL(mustGetEnv('MULTIHASHES_QUEUE_URL'))
  const region = mustGetEnv('INDEXER_REGION')
  const client = getSQSClient({ region })
  const multihashesQueue = createMultihashesQueue(client, { url })

  const { ok, error } = await publishBlockAdvertisement({ multihashesQueue }, advert)
  if (error) {
    console.error(error)
    return {
      statusCode: 500,
      body: error.message ?? 'failed to handle block advertisement publish message'
    }
  }

  return { statusCode: 200, body: ok }
}

/** @param {string} body */
const decodeMessage = (body) => {
  /** @type {import('../types.js').PublishAdvertisementMessage} */
  const raw = dagJSON.parse(body)
  if (!Array.isArray(raw.entries)) throw new Error('invalid message')
  return {
    entries: raw.entries.map((/** @type {Uint8Array} */r) => Digest.decode(r))
  }
}

export const main = Sentry.AWSLambda.wrapHandler(handleBlockAdvertPublishMessage)
