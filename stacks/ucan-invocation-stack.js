import {
  Bucket,
  Function,
  KinesisStream,
  Queue,
  use
} from 'sst/constructs'
import { Duration } from 'aws-cdk-lib'

import { BusStack } from './bus-stack.js'
import { UploadDbStack } from './upload-db-stack.js'
import {
  getBucketConfig,
  getKinesisEventSourceConfig,
  setupSentry
} from './config.js'

/**
 * @param {import('sst/constructs').StackContext} properties
 */
export function UcanInvocationStack({ stack, app }) {
  // Setup app monitoring with Sentry
  setupSentry(app, stack)

  // Get eventBus reference
  const { eventBus } = use(BusStack)
  const { adminMetricsTable } = use(UploadDbStack)

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
    handler: 'ucan-invocation/functions/ucan-bucket-event.ucanBucketConsumer',
  })
  ucanBucket.addNotifications(stack, {
    newCarPut: {
      function: ucanPutEventConsumer,
      events: ['object_created_put'],
    }
  })

  const metricsStoreAddSizeTotalDLQ = new Queue(stack, 'metrics-store-add-size-total-dlq')
  const metricsStoreAddSizeTotalConsumer = new Function(stack, 'metrics-store-add-size-total-consumer', {
    environment: {
      TABLE_NAME: adminMetricsTable.tableName
    },
    permissions: [adminMetricsTable],
    handler: 'ucan-invocation/functions/metrics-store-add-size-total.consumer',
    deadLetterQueue: metricsStoreAddSizeTotalDLQ.cdk.queue,
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
      metricsStoreAddSizeTotalConsumer: {
        function: metricsStoreAddSizeTotalConsumer,
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