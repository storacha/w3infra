import * as Sentry from '@sentry/serverless'
import * as dagJSON from '@ipld/dag-json'
import * as Monitor from '../monitor.js'
import { mustGetEnv } from '../../lib/env.js'
import { getDynamoClient } from '../../lib/aws/dynamo.js'

Sentry.AWSLambda.init({
  environment: process.env.SST_STAGE,
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 1.0,
})

/**
 * AWS HTTP Gateway handler for GET /sample.
 *
 * @param {{ queryStringParameters?: import('aws-lambda').APIGatewayProxyEventQueryStringParameters }} event
 */
export const sampleGet = async (event) => {
  const dynamo = getDynamoClient({ region: process.env.AWS_REGION ?? 'us-west-2' })
  const tableName = mustGetEnv('UPLOAD_TABLE_NAME')

  /** @type {number|undefined} */
  let size
  if (event.queryStringParameters?.size) {
    size = parseInt(event.queryStringParameters.size)
    size = isNaN(size) ? undefined : size
  }

  const samples = []
  for await (const sample of Monitor.sampleUploads(dynamo, tableName, { size })) {
    samples.push(sample)
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: dagJSON.stringify(samples)
  }
}

export const handler = Sentry.AWSLambda.wrapHandler((event) => sampleGet(event))
