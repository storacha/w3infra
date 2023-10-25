import * as Sentry from '@sentry/serverless'
import { notNully } from './lib.js'
import * as BillingInstruction from '../data/customer-billing-instruction.js'
import { createSubscriptionStore } from '../tables/subscription.js'
import { createConsumerStore } from '../tables/consumer.js'
import { createSpaceBillingQueue } from '../queues/space.js'
import { handleCustomerBillingInstruction } from '../lib/customer-billing-queue.js'

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
 *   spaceBillingQueueURL?: URL
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
    const spaceBillingQueueURL = new URL(customContext?.spaceBillingQueueURL ?? notNully(process.env, 'SPACE_BILLING_QUEUE_URL'))
    const region = customContext?.region ?? notNully(process.env, 'AWS_REGION')

    const { ok: instructions, error } = parseCustomerBillingInstructionEvent(event)
    if (error) throw error

    const ctx = {
      subscriptionStore: createSubscriptionStore({ region }, { tableName: subscriptionTable }),
      consumerStore: createConsumerStore({ region }, { tableName: consumerTable }),
      spaceBillingQueue: createSpaceBillingQueue({ region }, { url: spaceBillingQueueURL })
    }
    for (const instruction of instructions) {
      const { error } = await handleCustomerBillingInstruction(instruction, ctx)
      if (error) throw error
    }
  }
)

/**
 * @param {import('aws-lambda').SQSEvent} event
 * @returns {import('@ucanto/interface').Result<import('../lib/api.js').CustomerBillingInstruction[], import('../lib/api.js').DecodeFailure>}
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
