import { use, Table, Cron, Queue, Function } from '@serverless-stack/resources'
import {
  customerTableProps,
  spaceSizeSnapshotTableProps,
  spaceSizeDiffTableProps
} from '../billing/tables/index.js'
import { UcanInvocationStack } from './ucan-invocation-stack.js'
import { setupSentry, getKinesisEventSourceConfig } from './config.js'

/** @param {import('@serverless-stack/resources').StackContext} props */
export function BillingStack ({ stack, app }) {
  stack.setDefaultFunctionProps({ srcPath: 'billing' })

  setupSentry(app, stack)

  const customerTable = new Table(stack, 'customer', customerTableProps)
  const spaceSizeSnapshotTable = new Table(stack, 'space-size-snapshot', spaceSizeSnapshotTableProps)
  const spaceSizeDiffTable = new Table(stack, 'space-size-diff', spaceSizeDiffTableProps)

  // Lambda that does a billing run for a given account
  const billingQueueHandler = new Function(stack, 'billing-queue-handler', {
    permissions: [spaceSizeSnapshotTable, spaceSizeDiffTable],
    handler: 'functions/billing-queue.handler',
    timeout: '15 minutes'
  })

  // Queue of accounts that need billing
  const billingQueue = new Queue(stack, 'billing-queue', {
    consumer: {
      function: billingQueueHandler,
      cdk: { eventSource: { batchSize: 1 } }
    }
  })

  // Lambda that queues account DIDs to be billed
  const runnerHandler = new Function(stack, 'runner-handler', {
    permissions: [customerTable, billingQueue],
    handler: 'functions/runner.handler',
    timeout: '15 minutes'
  })

  // Cron job to kick off a billing run
  const runnerCron = new Cron(stack, 'runner', {
    job: runnerHandler,
    schedule: 'cron(0 0 1 * *)' // https://crontab.guru/#0_0_1_*_*
  })

  const { ucanStream } = use(UcanInvocationStack)

  // Lambda that receives UCAN stream events and writes diffs to spaceSizeDiffTable
  const ucanStreamHandler = new Function(stack, 'ucan-stream-handler', {
    permissions: [spaceSizeDiffTable],
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

  return { spaceSizeSnapshotTable, spaceSizeDiffTable, runnerCron }
}
