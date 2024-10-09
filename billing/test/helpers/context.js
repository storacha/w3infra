import { createDynamoDB, createSQS, createQueue, createTable } from './aws.js'
import { createCustomerStore, customerTableProps } from '../../tables/customer.js'
import { encode as encodeCustomer, validate as validateCustomer } from '../../data/customer.js'
import { decode as decodeCustomerBillingInstruction } from '../../data/customer-billing-instruction.js'
import { decode as decodeSpaceBillingInstruction } from '../../data/space-billing-instruction.js'
import { encode as encodeSubscription, validate as validateSubscription } from '../../data/subscription.js'
import { encode as encodeConsumer, validate as validateConsumer } from '../../data/consumer.js'
import { decode as decodeUsage, lister as usageLister } from '../../data/usage.js'
import { encode as encodeEgressEvent, decodeStr as decodeEgressEvent, validate as validateEgressEvent } from '../../data/egress.js'
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
import { createEgressEventQueue } from '../../queues/egress.js'
import { egressTableProps, createEgressEventStore } from '../../tables/egress.js'
import { handler as createEgressTrafficHandler } from '../../functions/egress-traffic-handler.js'
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

export const createEgressTrafficQueueTestContext = async () => {
  await createAWSServices()

  const egressTableName = await createTable(awsServices.dynamo.client, egressTableProps, 'egress-')
  const store = createEgressEventStore(awsServices.dynamo.client, { tableName: egressTableName })
  const egressEventStore = {
    put: store.put,
    list: store.list,
  }

  const egressQueueURL = new URL(await createQueue(awsServices.sqs.client, 'egress-traffic-'))
  const egressQueue = {
    add: createEgressEventQueue(awsServices.sqs.client, { url: egressQueueURL }).add,
    remove: createQueueRemoverClient(awsServices.sqs.client, { url: egressQueueURL, decode: decodeEgressEvent }).remove,
  }

  return {
    egressEventStore,
    egressQueue,
    egressHandler: createEgressTrafficHandler,
    egressTable: egressTableName,
    queueUrl: egressQueueURL,
      accountId: (await awsServices.dynamo.client.config.credentials()).accountId,
    callbackWaitsForEmptyEventLoop: true,
    functionName: 'your-function-name',
    functionVersion: 'your-function-version',
    region: awsServices.dynamo.client.config.region,
    invokedFunctionArn: `arn:aws:lambda:${awsServices.dynamo.client.config.region}:${awsServices.dynamo.client.config.credentials().accountId}:function:your-function-name`,
    memoryLimitInMB: '128',
    awsRequestId: 'your-request-id',
    logGroupName: '/aws/lambda/your-function-name',
    logStreamName: 'your-log-stream',
    getRemainingTimeInMillis: () => 1000,
    done: () => {},
    fail: () => {},
    succeed: () => {},
    stripeSecretKey: "", // FIXME (fforbeck): how to get Stripe secret key in a test?
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
