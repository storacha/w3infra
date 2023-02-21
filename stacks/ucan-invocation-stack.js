import {
  Bucket,
  Function,
  KinesisStream,
  Queue,
  use
} from '@serverless-stack/resources'
import { Duration } from 'aws-cdk-lib'

import { BusStack } from './bus-stack.js'
import { UploadDbStack } from './upload-db-stack.js'
import {
  getBucketConfig,
  getKinesisEventSourceConfig,
  setupSentry
} from './config.js'

/**
 * @param {import('@serverless-stack/resources').StackContext} properties
 */
export function UcanInvocationStack({ stack, app }) {
  stack.setDefaultFunctionProps({
    srcPath: 'ucan-invocation'
  })

  // Setup app monitoring with Sentry
  setupSentry(app, stack)

  // Get eventBus reference
  const { eventBus } = use(BusStack)
  const { w3MetricsTable } = use(UploadDbStack)

  const ucanBucket = new Bucket(stack, 'ucan-store', {
    cors: true,
    cdk: {
      bucket: getBucketConfig('ucan-store', app.stage)
    }
  })

  // Trigger ucan store events when a CAR is put into the bucket.
  const ucanPutEventConsumer = new Function(stack, 'ucan-consumer', {
    environment: {
      EVENT_BUS_ARN: eventBus.eventBusArn,
    },
    permissions: [eventBus],
    handler: 'functions/ucan-bucket-event.ucanBucketConsumer',
  })
  ucanBucket.addNotifications(stack, {
    newCarPut: {
      function: ucanPutEventConsumer,
      events: ['object_created_put'],
    }
  })

  const metricsAccumulatedSizeDLQ = new Queue(stack, 'metrics-accumulated-size-dlq')
  const metricsAccumulatedSizeConsumer = new Function(stack, 'metrics-accumulated-size-consumer', {
    environment: {
      TABLE_NAME: w3MetricsTable.tableName
    },
    permissions: [w3MetricsTable],
    handler: 'functions/metrics-accumulated-size.consumer',
    deadLetterQueue: metricsAccumulatedSizeDLQ.cdk.queue,
  })

  // create a kinesis stream
  const ucanStream = new KinesisStream(stack, 'ucan-stream', {
    cdk: {
      stream: {
        retentionPeriod: Duration.days(365)
      }
    },
    consumers: {
      // consumer1: 'functions/consumer1.handler'
      metricsAccumulatedSizeConsumer: {
        function: metricsAccumulatedSizeConsumer,
        // TODO: Set kinesis filters when supported by SST
        // https://github.com/serverless-stack/sst/issues/1407
        cdk: {
          eventSource: {
            ...(getKinesisEventSourceConfig(stack))
          }
        }
      }
    },
  })

  return {
    ucanBucket,
    ucanStream
  }
}