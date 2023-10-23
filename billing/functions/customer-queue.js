import * as Sentry from '@sentry/serverless'
import { notNully } from './lib.js'
import * as BillingInstruction from '../data/customer-billing-instruction.js'
import { createSubscriptionStore } from '../tables/subscription.js'
import { createConsumerStore } from '../tables/consumer.js'
import { createSpaceBillingQueue } from '../queues/space.js'
import { handleCustomerBillingInstruction } from '../lib/customer-queue.js'

Sentry.AWSLambda.init({
  environment: process.env.SST_STAGE,
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 1.0
})

/**
 * @typedef {{
 *   spaceDiffTable?: string
 *   consumerTable?: string
 *   usageTable?: string
 *   dbEndpoint?: URL
 *   qEndpoint?: URL
 *   region?: 'us-west-2'|'us-east-2'
 * }} CustomHandlerContext
 */

export const handler = Sentry.AWSLambda.wrapHandler(
  /**
   * @param {import('aws-lambda').SQSEvent} event
   * @param {import('aws-lambda').Context} context
   */
  async (event, context) => {
    /** @type {CustomHandlerContext|undefined} */
    const customContext = context?.clientContext?.Custom
    const subscriptionTable = customContext?.spaceDiffTable ?? notNully(process.env, 'SUBSCRIPTION_TABLE_NAME')
    const consumerTable = customContext?.consumerTable ?? notNully(process.env, 'CONSUMER_TABLE_NAME')
    const dbEndpoint = new URL(customContext?.dbEndpoint ?? notNully(process.env, 'DB_ENDPOINT'))
    const qEndpoint = new URL(customContext?.qEndpoint ?? notNully(process.env, 'Q_ENDPOINT'))
    const region = customContext?.region ?? notNully(process.env, 'AWS_REGION')

    const { ok: instructions, error } = parseCustomerBillingInstructionEvent(event)
    if (error) throw error

    const storeOptions = { endpoint: dbEndpoint }
    const queueOptions = { endpoint: qEndpoint }
    const ctx = {
      subscriptionStore: createSubscriptionStore(region, subscriptionTable, storeOptions),
      consumerStore: createConsumerStore(region, consumerTable, storeOptions),
      spaceBillingQueue: createSpaceBillingQueue(region, queueOptions)
    }
    for (const instruction of instructions) {
      const { error } = await handleCustomerBillingInstruction(instruction, ctx)
      if (error) throw error
    }
  }
)

/**
 * @param {import('aws-lambda').SQSEvent} event
 * @returns {import('@ucanto/interface').Result<import('../lib/api').CustomerBillingInstruction[], import('../lib/api').DecodeFailure>}
 */
const parseCustomerBillingInstructionEvent = (event) => {
  const instructions = []
  for (const record of event.Records) {
    const res = BillingInstruction.decode(record.body)
    if (res.error) return res
    instructions.push(res.ok)
  }
  return { ok: instructions }
}
