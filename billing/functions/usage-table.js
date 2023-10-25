import * as Sentry from '@sentry/serverless'
import { unmarshall } from '@aws-sdk/util-dynamodb'
import * as Usage from '../data/usage.js'

Sentry.AWSLambda.init({
  environment: process.env.SST_STAGE,
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 1.0
})

/**
 * @typedef {{}} CustomHandlerContext
 */

export const handler = Sentry.AWSLambda.wrapHandler(
  /**
   * @param {import('aws-lambda').DynamoDBStreamEvent} event
   * @param {import('aws-lambda').Context} context
   */
  async (event, context) => {
    // /** @type {CustomHandlerContext|undefined} */
    // const customContext = context?.clientContext?.Custom
    // TODO: stripe publishable key or something?
  
    const usages = parseUsageInsertEvent(event)
    if (!usages.length) return

    for (const u of usages) {
      // TODO: send request to stripe
      console.log(u)
    }
  }
)

/**
 * @param {import('aws-lambda').DynamoDBStreamEvent} event
 */
const parseUsageInsertEvent = event => {
  const usages = []
  for (const r of event.Records) {
    if (r.eventName !== 'INSERT') continue
    if (!r.dynamodb) continue
    if (!r.dynamodb.NewImage) throw new Error('missing "NEW_IMAGE" in stream event')
    // @ts-expect-error IDK why this is not Record<string, AttributeValue>
    const { ok: usage, error } = Usage.decode(unmarshall(r.dynamodb.NewImage))
    if (error) throw error
    usages.push(usage)
  }
  return usages
}
