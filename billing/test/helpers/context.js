import dotenv from 'dotenv'
import path from 'node:path'
import Stripe from 'stripe'
import { createDynamoDB, createSQS, createQueue, createTable } from './aws.js'
import { createCustomerStore, customerTableProps } from '../../tables/customer.js'
import { encode as encodeCustomer, validate as validateCustomer } from '../../data/customer.js'
import { decode as decodeCustomerBillingInstruction } from '../../data/customer-billing-instruction.js'
import { decode as decodeSpaceBillingInstruction } from '../../data/space-billing-instruction.js'
import { encode as encodeSubscription, validate as validateSubscription } from '../../data/subscription.js'
import { encode as encodeConsumer, validate as validateConsumer } from '../../data/consumer.js'
import { decode as decodeUsage, lister as usageLister } from '../../data/usage.js'
import { decodeStr as decodeEgressTrafficEvent } from '../../data/egress.js'
import { createCustomerBillingQueue } from '../../queues/customer.js'
import { createSpaceBillingQueue } from '../../queues/space.js'
import { consumerTableProps, subscriptionTableProps } from '../../../upload-api/tables/index.js'
import { createStoreListerClient, createStorePutterClient } from '../../tables/client.js'
import { createSubscriptionStore } from '../../tables/subscription.js'
import { createConsumerStore } from '../../tables/consumer.js'
import { createSpaceDiffStore, spaceDiffTableProps } from '../../tables/space-diff.js'
import { createSpaceSnapshotStore, spaceSnapshotTableProps } from '../../tables/space-snapshot.js'
import { createUsageStore, usageTableProps } from '../../tables/usage.js'
import { createQueueRemoverClient } from './queue.js'
import { createEgressTrafficQueue } from '../../queues/egress-traffic.js'
import { handler as createEgressTrafficHandler } from '../../functions/egress-traffic-handler.js'

dotenv.config({ path: path.resolve('../.env.local'), override: true, debug: true })

/**
 * @typedef {{
 *  dynamo: import('./aws').AWSService<import('@aws-sdk/client-dynamodb').DynamoDBClient>
 *  sqs: import('./aws').AWSService<import('@aws-sdk/client-sqs').SQSClient>
 * }} AWSServices
 */

/** @type {AWSServices} */
let awsServices
const createAWSServices = async () => {
  awsServices = awsServices ?? {
    dynamo: await createDynamoDB(),
    sqs: await createSQS()
  }
}

export const createBillingCronTestContext = async () => {
  await createAWSServices()

  const customerTableName = await createTable(awsServices.dynamo.client, customerTableProps, 'customer-')
  const customerStore = {
    ...createCustomerStore(awsServices.dynamo.client, { tableName: customerTableName }),
    ...createStorePutterClient(awsServices.dynamo.client, {
      tableName: customerTableName,
      validate: validateCustomer, // assume test data is valid
      encode: encodeCustomer
    })
  }
  const customerBillingQueueURL = new URL(await createQueue(awsServices.sqs.client, 'customer-billing-'))
  const customerBillingQueue = {
    ...createCustomerBillingQueue(awsServices.sqs.client, { url: customerBillingQueueURL }),
    ...createQueueRemoverClient(awsServices.sqs.client, {
      url: customerBillingQueueURL,
      decode: decodeCustomerBillingInstruction
    })
  }

  return { customerStore, customerBillingQueue }
}

export const createCustomerBillingQueueTestContext = async () => {
  await createAWSServices()

  const subscriptionTableName = await createTable(awsServices.dynamo.client, subscriptionTableProps, 'subscription-')
  const subscriptionStore = {
    ...createSubscriptionStore(awsServices.dynamo.client, { tableName: subscriptionTableName }),
    ...createStorePutterClient(awsServices.dynamo.client, {
      tableName: subscriptionTableName,
      validate: validateSubscription, // assume test data is valid
      encode: encodeSubscription
    })
  }
  const consumerTableName = await createTable(awsServices.dynamo.client, consumerTableProps, 'consumer-')
  const consumerStore = {
    ...createConsumerStore(awsServices.dynamo.client, { tableName: consumerTableName }),
    ...createStorePutterClient(awsServices.dynamo.client, {
      tableName: consumerTableName,
      validate: validateConsumer, // assume test data is valid
      encode: encodeConsumer
    })
  }
  const spaceBillingQueueURL = new URL(await createQueue(awsServices.sqs.client, 'space-billing-'))
  const spaceBillingQueue = {
    ...createSpaceBillingQueue(awsServices.sqs.client, { url: spaceBillingQueueURL }),
    ...createQueueRemoverClient(awsServices.sqs.client, {
      url: spaceBillingQueueURL,
      decode: decodeSpaceBillingInstruction
    })
  }

  return { subscriptionStore, consumerStore, spaceBillingQueue }
}

export const createSpaceBillingQueueTestContext = async () => {
  await createAWSServices()

  const spaceDiffTableName = await createTable(awsServices.dynamo.client, spaceDiffTableProps, 'space-diff-')
  const spaceDiffStore = createSpaceDiffStore(awsServices.dynamo.client, { tableName: spaceDiffTableName })
  const spaceSnapshotTableName = await createTable(awsServices.dynamo.client, spaceSnapshotTableProps, 'space-snapshot-')
  const spaceSnapshotStore = createSpaceSnapshotStore(awsServices.dynamo.client, { tableName: spaceSnapshotTableName })
  const usageTableName = await createTable(awsServices.dynamo.client, usageTableProps, 'usage-')
  const usageStore = {
    ...createUsageStore(awsServices.dynamo.client, { tableName: usageTableName }),
    ...createStoreListerClient(awsServices.dynamo.client, {
      tableName: usageTableName,
      encodeKey: usageLister.encodeKey,
      decode: decodeUsage
    })
  }

  return { spaceDiffStore, spaceSnapshotStore, usageStore }
}

export const createStripeTestContext = async () => {
  await createAWSServices()

  const customerTableName = await createTable(awsServices.dynamo.client, customerTableProps, 'customer-')
  const customerStore = createCustomerStore(awsServices.dynamo.client, { tableName: customerTableName })

  return { customerStore }
}

export const createUCANStreamTestContext = async () => {
  await createAWSServices()

  const spaceDiffTableName = await createTable(awsServices.dynamo.client, spaceDiffTableProps, 'space-diff-')
  const spaceDiffStore = createSpaceDiffStore(awsServices.dynamo.client, { tableName: spaceDiffTableName })
  const consumerTableName = await createTable(awsServices.dynamo.client, consumerTableProps, 'consumer-')
  const consumerStore = {
    ...createConsumerStore(awsServices.dynamo.client, { tableName: consumerTableName }),
    ...createStorePutterClient(awsServices.dynamo.client, {
      tableName: consumerTableName,
      validate: validateConsumer, // assume test data is valid
      encode: encodeConsumer
    })
  }

  return { consumerStore, spaceDiffStore }
}

/**
 * @returns {Promise<import('../lib/api').EgressTrafficTestContext>}
 */
export const createEgressTrafficTestContext = async () => {
  await createAWSServices()
  const stripeSecretKey = process.env.STRIPE_TEST_SECRET_KEY
  if (!stripeSecretKey) {
    throw new Error('STRIPE_TEST_SECRET_KEY environment variable is not set')
  }

  const egressQueueURL = new URL(await createQueue(awsServices.sqs.client, 'egress-traffic-queue-'))
  const egressTrafficQueue = {
    add: createEgressTrafficQueue(awsServices.sqs.client, { url: egressQueueURL }).add,
    remove: createQueueRemoverClient(awsServices.sqs.client, { url: egressQueueURL, decode: decodeEgressTrafficEvent }).remove,
  }

  const accountId = (await awsServices.sqs.client.config.credentials()).accountId
  const region = await awsServices.sqs.client.config.region()

  return {
    egressTrafficQueue,
    egressTrafficQueueUrl: egressQueueURL.toString(),
    egressTrafficHandler: createEgressTrafficHandler,
    accountId: accountId ?? '',
    region: region ?? '',
    stripeSecretKey,
    stripe: new Stripe(stripeSecretKey, { apiVersion: '2023-10-16' }),
    // Add mock properties for default Context
    callbackWaitsForEmptyEventLoop: false,
    functionName: 'egress-traffic-handler',
    functionVersion: '1',
    invokedFunctionArn: `arn:aws:lambda:${region}:${accountId}:function:egress-traffic-handler`,
    memoryLimitInMB: '128',
    awsRequestId: 'mockRequestId',
    logGroupName: 'mockLogGroup',
    logStreamName: 'mockLogStream',
    identity: undefined,
    clientContext: undefined,
    getRemainingTimeInMillis: () => 30000, // mock implementation
    done: () => {
      console.log('Egress traffic handler done')
    },
    fail: () => {
      console.log('Egress traffic handler fail')
    },
    succeed: () => {
      console.log('Egress traffic handler succeed')
    }
  }
}

/**
 * @template C
 * @param {import('../lib/api').TestSuite<C>} suite
 * @param {() => Promise<C>} createContext
 */
export const bindTestContext = (suite, createContext) => {
  /** @type {import('../lib/api').TestSuite<C>} */
  const test = {}
  for (const [name, impl] of Object.entries(suite)) {
    test[name] = async (assert) => impl(assert, await createContext())
  }
  return test
}
