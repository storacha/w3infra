import * as Sentry from '@sentry/serverless'
import { Config } from '@serverless-stack/node/config/index.js'
import { unmarshall } from '@aws-sdk/util-dynamodb'
import Stripe from 'stripe'
import Big from 'big.js'
import * as Usage from '../data/usage.js'

Sentry.AWSLambda.init({
  environment: process.env.SST_STAGE,
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 1.0
})

/**
 * @typedef {{ stripeSecretKey: string }} CustomHandlerContext
 */

export const handler = Sentry.AWSLambda.wrapHandler(
  /**
   * @param {import('aws-lambda').DynamoDBStreamEvent} event
   * @param {import('aws-lambda').Context} context
   */
  async (event, context) => {
    /** @type {CustomHandlerContext|undefined} */
    const customContext = context?.clientContext?.Custom
    const stripeSecretKey = customContext?.stripeSecretKey ?? Config.STRIPE_SECRET_KEY
    if (!stripeSecretKey) throw new Error('missing secret: STRIPE_SECRET_KEY')

    const records = parseUsageInsertEvent(event)
    if (!records.length) return

    const ctx = {
      stripe: new Stripe(stripeSecretKey, { apiVersion: '2023-10-16' })
    }
    for (const usage of records) {
      const { error } = await handleUsage(usage, ctx)
      if (error) throw error
    }
  }
)

/**
 * @param {import('aws-lambda').DynamoDBStreamEvent} event
 */
const parseUsageInsertEvent = event => {
  const records = []
  for (const r of event.Records) {
    if (r.eventName !== 'INSERT') continue
    if (!r.dynamodb) continue
    if (!r.dynamodb.NewImage) throw new Error('missing "NEW_IMAGE" in stream event')
    // @ts-expect-error IDK why this is not Record<string, AttributeValue>
    const { ok: usage, error } = Usage.decode(unmarshall(r.dynamodb.NewImage))
    if (error) throw error
    records.push(usage)
  }
  return records
}

/**
 * @param {import('../lib/api.js').Usage} usage 
 * @param {{ stripe: Stripe }} ctx
 * @returns {Promise<import('@ucanto/interface').Result>}
 */
const handleUsage = async (usage, ctx) => {
  console.log(`Processing usage for: ${usage.space}`)
  console.log(`Provider: ${usage.provider}`)
  console.log(`Customer: ${usage.customer}`)
  console.log(`Period: ${usage.from.toISOString()} - ${usage.to.toISOString()}`)

  const { data: subs } = await ctx.stripe.subscriptions.list({
    customer: usage.account,
    status: 'all',
    limit: 1
  })

  const subID = subs[0]?.id
  if (!subID) {
    return { error: new Error(`No subscriptions: ${usage.account}`) }
  }
  console.log(`Found Stripe subscription item: ${subID}`)

  const duration = usage.to.getTime() - usage.from.getTime()
  const quantity = new Big(usage.usage.toString()).div(duration).div(1024 * 1024 * 1024).toNumber()
  const idempotencyKey = `${usage.from.toISOString()}-${usage.to.toISOString()}/${usage.provider}/${usage.space}/${usage.customer}`
  const usageRecord = await ctx.stripe.subscriptionItems.createUsageRecord(
    subID,
    { quantity, action: 'increment' },
    { idempotencyKey }
  )

  console.log(`Created Stripe usage record with ID: ${usageRecord.id}`)
  return { ok: {} }
}
