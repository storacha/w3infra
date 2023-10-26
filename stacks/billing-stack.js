import { use, Cron, Queue, Function, Config } from '@serverless-stack/resources'
import { StartingPosition } from 'aws-cdk-lib/aws-lambda'
import { UcanInvocationStack } from './ucan-invocation-stack.js'
import { BillingDbStack } from './billing-db-stack.js'
import { UploadDbStack } from './upload-db-stack.js'
import { setupSentry, getKinesisEventSourceConfig } from './config.js'
import { Duration } from 'aws-cdk-lib'

/** @param {import('@serverless-stack/resources').StackContext} props */
export function BillingStack ({ stack, app }) {
  stack.setDefaultFunctionProps({ srcPath: 'billing' })

  setupSentry(app, stack)

  const {
    customerTable,
    spaceSnapshotTable,
    spaceDiffTable,
    usageTable
  } = use(BillingDbStack)
  const { subscriptionTable, consumerTable } = use(UploadDbStack)

  // Lambda that does a billing run for a given space and customer
  const spaceBillingQueueHandlerDLQ = new Queue(stack, 'space-billing-queue-handler-dlq', {
    cdk: { queue: { retentionPeriod: Duration.days(14) } }
  })
  const spaceBillingQueueHandler = new Function(stack, 'space-billing-queue-handler', {
    permissions: [spaceSnapshotTable, spaceDiffTable, usageTable],
    handler: 'functions/space-billing-queue.handler',
    timeout: '15 minutes',
    environment: {
      SPACE_DIFF_TABLE_NAME: spaceDiffTable.tableName,
      SPACE_SNAPSHOT_TABLE_NAME: spaceSnapshotTable.tableName,
      USAGE_TABLE_NAME: usageTable.tableName
    },
    deadLetterQueueEnabled: true,
    deadLetterQueue: spaceBillingQueueHandlerDLQ.cdk.queue
  })

  // Queue of spaces and customers that need billing
  const spaceBillingQueue = new Queue(stack, 'space-billing-queue', {
    consumer: {
      function: spaceBillingQueueHandler,
      cdk: { eventSource: { batchSize: 1 } }
    }
  })

  // Lambda that does a billing run for a given customer
  const customerBillingQueueHandlerDLQ = new Queue(stack, 'customer-billing-queue-handler-dlq', {
    cdk: { queue: { retentionPeriod: Duration.days(14) } }
  })
  const customerBillingQueueHandler = new Function(stack, 'customer-billing-queue-handler', {
    permissions: [subscriptionTable, consumerTable, spaceBillingQueue],
    handler: 'functions/customer-billing-queue.handler',
    timeout: '15 minutes',
    environment: {
      SUBSCRIPTION_TABLE_NAME: subscriptionTable.tableName,
      CONSUMER_TABLE_NAME: consumerTable.tableName,
      SPACE_BILLING_QUEUE_URL: spaceBillingQueue.queueUrl
    },
    deadLetterQueueEnabled: true,
    deadLetterQueue: customerBillingQueueHandlerDLQ.cdk.queue
  })

  // Queue of accounts that need billing
  const customerBillingQueue = new Queue(stack, 'customer-billing-queue', {
    consumer: {
      function: customerBillingQueueHandler,
      cdk: { eventSource: { batchSize: 1 } }
    }
  })

  // Lambda that queues account DIDs to be billed
  const billingCronHandler = new Function(stack, 'billing-cron-handler', {
    permissions: [customerTable, customerBillingQueue],
    handler: 'functions/billing-cron.handler',
    timeout: '15 minutes',
    environment: {
      CUSTOMER_TABLE_NAME: customerTable.tableName,
      CUSTOMER_BILLING_QUEUE_URL: customerBillingQueue.queueUrl
    }
  })

  // Cron job to kick off a billing run
  const billingCron = new Cron(stack, 'billing-cron', {
    job: billingCronHandler,
    schedule: 'cron(0 0 1 * ? *)' // https://crontab.guru/#0_0_1_*_*
  })

  const { ucanStream } = use(UcanInvocationStack)

  // Lambda that receives UCAN stream events and writes diffs to spaceSizeDiffTable
  const ucanStreamHandler = new Function(stack, 'ucan-stream-handler', {
    permissions: [spaceDiffTable, subscriptionTable, consumerTable],
    handler: 'functions/ucan-stream.handler',
    environment: {
      SPACE_DIFF_TABLE_NAME: spaceDiffTable.tableName,
      SUBSCRIPTION_TABLE_NAME: subscriptionTable.tableName,
      CONSUMER_TABLE_NAME: consumerTable.tableName
    }
  })

  ucanStream.addConsumers(stack, {
    ucanStreamHandler: {
      function: ucanStreamHandler,
      // TODO: Set kinesis filters when supported by SST
      // https://github.com/serverless-stack/sst/issues/1407
      cdk: { eventSource: getKinesisEventSourceConfig(stack) }
    }
  })

  const stripeSecretKey = new Config.Secret(stack, 'STRIPE_SECRET_KEY')

  // Lambda that sends usage table records to Stripe for invoicing.
  const usageTableHandlerDLQ = new Queue(stack, 'usage-table-handler-dlq', {
    cdk: { queue: { retentionPeriod: Duration.days(14) } }
  })
  const usageTableHandler = new Function(stack, 'usage-table-handler', {
    permissions: [spaceSnapshotTable, spaceDiffTable],
    handler: 'functions/usage-table.handler',
    timeout: '15 minutes',
    bind: [stripeSecretKey],
    deadLetterQueueEnabled: true,
    deadLetterQueue: usageTableHandlerDLQ.cdk.queue
  })

  usageTable.addConsumers(stack, {
    usageTableHandler: {
      function: usageTableHandler,
      cdk: {
        eventSource: {
          batchSize: 1,
          startingPosition: StartingPosition.LATEST
        }
      },
      filters: [{ eventName: ['INSERT'] }]
    }
  })

  return { runnerCron: billingCron }
}
