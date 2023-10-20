import * as Sentry from '@sentry/serverless'
import { notNully } from './lib.js'
import * as BillingInstruction from '../data/customer-billing-instruction.js'
import { createSubscriptionStore } from '../tables/subscription.js'
import { createConsumerStore } from '../tables/consumer.js'

Sentry.AWSLambda.init({
  environment: process.env.SST_STAGE,
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 1.0
})

/**
 * @typedef {{
 *   spaceDiffTable?: string
 *   spaceSnapshotTable?: string
 *   usageTable?: string
 *   dbEndpoint?: URL
 *   region?: 'us-west-2'|'us-east-2'
 * }} CustomHandlerContext
 */

/**
 * @param {import('aws-lambda').SQSEvent} event
 * @param {import('aws-lambda').Context} context
 */
export const _handler = async (event, context) => {
  /** @type {CustomHandlerContext|undefined} */
  const customContext = context?.clientContext?.Custom
  const subscriptionTable = customContext?.spaceDiffTable ?? notNully(process.env, 'SUBSCRIPTION_TABLE_NAME')
  const consumerTable = customContext?.spaceSnapshotTable ?? notNully(process.env, 'CONSUMER_TABLE_NAME')
  const dbEndpoint = new URL(customContext?.dbEndpoint ?? notNully(process.env, 'DYNAMO_DB_ENDPOINT'))
  const region = customContext?.region ?? notNully(process.env, 'AWS_REGION')

  const { ok: instructions, error } = parseCustomerBillingInstructionEvent(event)
  if (error) throw error

  const storeOptions = { endpoint: dbEndpoint }
  const stores = {
    subscriptionStore: createSubscriptionStore(region, subscriptionTable, storeOptions),
    consumerStore: createConsumerStore(region, consumerTable, storeOptions)
  }
  for (const instruction of instructions) {
    const { error } = await processCustomerBillingInstruction(instruction, stores)
    if (error) throw error
  }
}

export const handler = Sentry.AWSLambda.wrapHandler(_handler)

/**
 * @param {import('aws-lambda').SQSEvent} event
 * @returns {import('@ucanto/interface').Result<import('../types.js').CustomerBillingInstruction[], import('../types.js').DecodeFailure>}
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

/**
 * @param {import('../types.js').CustomerBillingInstruction} instruction 
 * @param {{
 *   subscriptionStore: import('../types.js').SubscriptionStore
 *   consumerStore: import('../types.js').ConsumerStore
 * }} stores
 * @returns {Promise<import('@ucanto/interface').Result>}
 */
const processCustomerBillingInstruction = async (instruction, {
  subscriptionStore,
  consumerStore
}) => {
  console.log(`processing customer billing instruction for: ${instruction.customer}`)
  console.log(`period: ${instruction.from.toISOString()} - ${instruction.to.toISOString()}`)

  subscriptionStore.list({ customer: instruction.customer })
  

  return { ok: {} }
}
