import { use, Cron, Queue, Function } from '@serverless-stack/resources'
import { StartingPosition } from 'aws-cdk-lib/aws-lambda'
import { UcanInvocationStack } from './ucan-invocation-stack.js'
import { BillingDbStack } from './billing-db-stack.js'
import { UploadDbStack } from './upload-db-stack.js'
import { setupSentry, getKinesisEventSourceConfig } from './config.js'

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
  const spaceBillingQueueHandler = new Function(stack, 'space-billing-queue-handler', {
    permissions: [spaceSnapshotTable, spaceDiffTable, usageTable],
    handler: 'functions/space-billing-queue.handler',
    timeout: '15 minutes'
  })

  // Queue of spaces and customers that need billing
  const spaceBillingQueue = new Queue(stack, 'space-billing-queue', {
    consumer: {
      function: spaceBillingQueueHandler,
      cdk: { eventSource: { batchSize: 1 } }
    }
  })

  // Lambda that does a billing run for a given customer
  const customerBillingQueueHandler = new Function(stack, 'customer-billing-queue-handler', {
    permissions: [subscriptionTable, consumerTable, spaceBillingQueue],
    handler: 'functions/customer-billing-queue.handler',
    timeout: '15 minutes'
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
    timeout: '15 minutes'
  })

  // Cron job to kick off a billing run
  const billingCron = new Cron(stack, 'billing-cron', {
    job: billingCronHandler,
    schedule: 'cron(0 0 1 * *)' // https://crontab.guru/#0_0_1_*_*
  })

  const { ucanStream } = use(UcanInvocationStack)

  // Lambda that receives UCAN stream events and writes diffs to spaceSizeDiffTable
  const ucanStreamHandler = new Function(stack, 'ucan-stream-handler', {
    permissions: [spaceDiffTable, subscriptionTable, consumerTable],
    handler: 'functions/ucan-stream.handler'
  })

  ucanStream.addConsumers(stack, {
    ucanStreamHandler: {
      function: ucanStreamHandler,
      // TODO: Set kinesis filters when supported by SST
      // https://github.com/serverless-stack/sst/issues/1407
      cdk: { eventSource: getKinesisEventSourceConfig(stack) }
    }
  })

  // Lambda that sends usage table records to Stripe for invoicing.
  const usageTableHandler = new Function(stack, 'usage-table-handler', {
    permissions: [spaceSnapshotTable, spaceDiffTable],
    handler: 'functions/usage-table.handler',
    timeout: '15 minutes'
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
