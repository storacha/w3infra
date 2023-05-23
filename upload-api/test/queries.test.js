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

test('provider finding its customers', async (t) => {
  const { dynamo } = t.context
  const subscriptions = await subscriptionsTable(dynamo)
  const customer = 'did:mailto:example@example.com'
  const provider = 'did:web:test.web3.storage'
  const subscription = '1'
  const cause = await randomCID()
  await subscriptions.insert({ customer, provider, subscription, cause })
  const customers = await subscriptions.findCustomersByProvider(provider)

  t.deepEqual(customers, [customer])
})

test('provider finding its consumers', async (t) => {
  const { dynamo } = t.context
  const consumers = await consumersTable(dynamo)
  const consumer = 'did:key:foo'
  const provider = 'did:web:test.web3.storage'
  const subscription = '1'
  const cause = await randomCID()
  await consumers.insert({ consumer, provider, subscription, cause })
  const foundConsumers = await consumers.findConsumersByProvider(provider)

  t.deepEqual(foundConsumers, [consumer])
})

test('provider canceling a subscription', async (t) => {
})

test('provider blocking a customer', async (t) => {
})

test('provider getting per customer/consumer/subscription stats', async (t) => {
})



test('space finding its providers/subscribers', async (t) => {
})

test('space removing a provider', async (t) => {
})

test('space finding its storage limits', async (t) => {
})


test('customer canceling its subscription', async (t) => {
})

test('customer listing its subscription', async (t) => {
})

test('customer getting subscription stats (data stored, etc)', async (t) => {
})