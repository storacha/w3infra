// eslint-disable-next-line no-unused-vars
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'

import { test } from './helpers/context.js'
import {
  createDynamodDb,
  createTable,
} from './helpers/resources.js'
import { consumerTableProps, subscriptionTableProps, } from '../tables/index.js'
import { useSubscriptionTable } from '../tables/subscription.js'
import { useConsumerTable } from '../tables/consumer.js'
import { randomCID } from './helpers/random.js'

/**
 * @typedef {import('@ucanto/interface').DID} DID
 * @typedef {import('@ucanto/interface').Link} Link
 * @typedef {import('./types').StaticQueriesFixtures} StaticQueriesFixtures
 */

test.before(async (t) => {
  Object.assign(t.context, {
    dynamo: await createDynamodDb(),
  })
})

/**
 * 
 * @param {DynamoDBClient} dynamo 
 */
async function subscriptionsTable (dynamo) {
  return useSubscriptionTable(
    dynamo,
    await createTable(dynamo, subscriptionTableProps)
  )
}

/**
 * 
 * @param {DynamoDBClient} dynamo 
 */
async function consumersTable (dynamo) {
  return useConsumerTable(
    dynamo,
    await createTable(dynamo, consumerTableProps)
  )
}

/**
 * @type {StaticQueriesFixtures | undefined}
 */
let staticFixtures

async function loadStaticFixtures () {
  if (!staticFixtures) {
    staticFixtures = {
      consumer: /** @type {DID} */ ('did:key:foo'),
      customer: /** @type {DID} */ ('did:mailto:example@example.com'),
      provider: /** @type {DID} */ ('did:web:test.web3.storage'),
      subscription: '1',
      cause: await randomCID()
    }
  }
  return staticFixtures
}

/**
 * 
 * @param {import('./helpers/context.js').DynamoContext} context 
 * @returns 
 */
async function subscriptionsTestFixture (context) {
  const { dynamo } = context
  const subscriptions = await subscriptionsTable(dynamo)
  const { customer, provider, subscription, cause } = await loadStaticFixtures()
  await subscriptions.add({ customer, provider, subscription, cause })
  return ({
    subscriptions,
    customer,
    provider,
    subscription,
    cause
  })
}

/**
 * 
 * @param {import('./helpers/context.js').DynamoContext} context 
 * @returns 
 */
async function consumersTestFixture (context) {
  const { dynamo } = context
  const consumers = await consumersTable(dynamo)
  const { consumer, provider, subscription, cause } = await loadStaticFixtures()
  await consumers.add({ consumer, provider, subscription, cause })
  return ({
    consumers,
    consumer,
    provider,
    subscription,
    cause
  })
}

// TODO: is this really valuable? we can remove the subscriptions global index on providers if not
test('provider finding its customers', async (t) => {
  const { subscriptions, provider, customer } = await subscriptionsTestFixture(t.context)
  const customers = await subscriptions.findCustomersByProvider(provider)

  t.deepEqual(customers, [customer])
})

// TODO: is this really valuable? we can remove the consumers global index on providers if not
test('provider finding its consumers', async (t) => {
  const { consumers, provider, consumer } = await consumersTestFixture(t.context)
  const foundConsumers = await consumers.findConsumersByProvider(provider)

  t.deepEqual(foundConsumers, [consumer])
})

test('finding the customer responsible for a space', async (t) => {
  const { subscriptions, customer } = await subscriptionsTestFixture(t.context)
  const { consumers, consumer } = await consumersTestFixture(t.context)
  const foundSubscriptions = await consumers.findSubscriptionsForConsumer(consumer)
  const foundCustomer = await subscriptions.findCustomerForSubscription(foundSubscriptions[0])

  t.is(foundCustomer, customer)
})

test('provider canceling a subscription', async (t) => {
})

test('provider blocking a customer', async (t) => {
})

test('provider getting per customer/consumer/subscription stats', async (t) => {
})


test('space finding its providers/subscribers', async (t) => {
  const { consumers, consumer, subscription } = await consumersTestFixture(t.context)
  const foundSubscriptions = await consumers.findSubscriptionsForConsumer(consumer)
  t.deepEqual(foundSubscriptions, [subscription])
})

test('space removing a provider', async (t) => {
})

test('space finding its storage limits', async (t) => {
})


test('customer canceling its subscription', async (t) => {
})

test('customer listing its subscription', async (t) => {
  const { subscriptions, customer, subscription } = await subscriptionsTestFixture(t.context)
  const foundSubscriptions = await subscriptions.findSubscriptionsForCustomer(customer)
  t.deepEqual(foundSubscriptions, [subscription])
})

test('customer getting subscription stats (data stored, etc)', async (t) => {
})