import * as Sentry from '@sentry/serverless'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import * as dagJSON from '@ipld/dag-json'
import * as Digest from 'multiformats/hashes/digest'
import { mustGetEnv } from './lib.js'
import { writeBlockIndexEntries } from '../lib/block-index-writer.js'

Sentry.AWSLambda.init({
  environment: process.env.SST_STAGE,
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 1.0,
})

/**
 * @param {import('aws-lambda').SQSEvent} sqsEvent
 */
const handleBlockIndexWriterMessage = async (sqsEvent) => {
  if (sqsEvent.Records.length !== 1) {
    return {
      statusCode: 400,
      body: `Expected 1 SQS message per invocation but received ${sqsEvent.Records.length}`
    }
  }

  const entries = decodeMessage(sqsEvent.Records[0].body)
  const tableName = mustGetEnv('BLOCKS_CAR_POSITION_TABLE_NAME')
  const region = mustGetEnv('INDEXER_REGION')
  const client = new DynamoDBClient({ region })

  const { ok, error } = await writeBlockIndexEntries({ tableName, client }, entries)
  if (error) {
    console.error(error)
    return {
      statusCode: 500,
      body: error.message ?? 'failed to handle block index writer message'
    }
  }

  return { statusCode: 200, body: ok }
}

/** @param {string} body */
const decodeMessage = (body) => {
  /** @type {import('../types.js').BlockIndexQueueMessage} */
  const raw = dagJSON.parse(body)
  if (!Array.isArray(raw)) throw new Error('invalid message')
  const location = new URL(raw[0])
  if (!Array.isArray(raw[1])) throw new Error('invalid message')
  return raw[1].map(r => ({
    digest: Digest.decode(r[0]),
    location,
    range: r[1]
  }))
}

export const main = Sentry.AWSLambda.wrapHandler(handleBlockIndexWriterMessage)
