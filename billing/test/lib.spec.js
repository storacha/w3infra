import { createDynamoDB, createQueue, createSQS, createTable } from './helpers/aws.js'
import { createCustomerStore, customerTableProps } from '../tables/customer.js'
import * as RunnerHandler from './lib/runner.js'
import { createStorePutterClient } from '../tables/client.js'
import * as Customer from '../data/customer.js'
import * as CustomerBillingInstruction from '../data/customer-billing-instruction.js'
import { createCustomerBillingQueue } from '../queues/customer.js'
import { createQueueRemoverClient } from './helpers/queue.js'

/**
 * @typedef {{
 *  dynamo: import('./helpers/aws').AWSService<import('@aws-sdk/client-dynamodb').DynamoDBClient>
 *  sqs: import('./helpers/aws').AWSService<import('@aws-sdk/client-sqs').SQSClient>
 * }} AWSServices
 */

/** @type {AWSServices} */
let awsServices
const before = async () => {
  awsServices = awsServices ?? {
    dynamo: await createDynamoDB(),
    sqs: await createSQS()
  }
}

const createTestContext = async () => {
  const customerTableName = await createTable(awsServices.dynamo.client, customerTableProps)
  const customerStore = {
    ...createCustomerStore(awsServices.dynamo.client, { tableName: customerTableName }),
    ...createStorePutterClient(awsServices.dynamo.client, {
      tableName: customerTableName,
      validate: () => ({ ok: {} }), // assume test data is valid
      encode: Customer.encode
    })
  }
  const customerBillingQueueURL = new URL(await createQueue(awsServices.sqs.client))
  const customerBillingQueue = {
    ...createCustomerBillingQueue(awsServices.sqs.client, { url: customerBillingQueueURL }),
    ...createQueueRemoverClient(awsServices.sqs.client, {
      url: customerBillingQueueURL,
      decode: CustomerBillingInstruction.decode
    })
  }
  return { customerStore, customerBillingQueue }
}

/** @type {import('./lib/api.js').TestSuite} */
const testRunnerHandler = {}
for (const [name, impl] of Object.entries(RunnerHandler.test)) {
  testRunnerHandler[name] = async (assert) => {
    await before()
    const ctx = await createTestContext()
    await impl(assert, ctx)
  }
}

export { testRunnerHandler }
