import {
  Bucket,
  Function,
  KinesisStream,
  Queue,
  use
} from '@serverless-stack/resources'
import { Duration } from 'aws-cdk-lib'

import { BusStack } from './bus-stack.js'
import { CarparkStack } from './carpark-stack.js'
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

  // Get dependent stack references
  const { eventBus } = use(BusStack)
  const { carparkBucket } = use(CarparkStack)
  const { adminMetricsTable, spaceMetricsTable } = use(UploadDbStack)

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

  // metrics store/add count
  const metricsStoreAddTotalDLQ = new Queue(stack, 'metrics-store-add-total-dlq')
  const metricsStoreAddTotalConsumer = new Function(stack, 'metrics-store-add-total-consumer', {
    environment: {
      TABLE_NAME: adminMetricsTable.tableName
    },
    permissions: [adminMetricsTable],
    handler: 'functions/metrics-store-add-total.consumer',
    deadLetterQueue: metricsStoreAddTotalDLQ.cdk.queue,
  })
  
  // metrics store/remove count
  const metricsStoreRemoveTotalDLQ = new Queue(stack, 'metrics-store-remove-total-dlq')
  const metricsStoreRemoveTotalConsumer = new Function(stack, 'metrics-store-remove-total-consumer', {
    environment: {
      TABLE_NAME: adminMetricsTable.tableName
    },
    permissions: [adminMetricsTable],
    handler: 'functions/metrics-store-remove-total.consumer',
    deadLetterQueue: metricsStoreRemoveTotalDLQ.cdk.queue,
  })

  // metrics store/add size total
  const metricsStoreAddSizeTotalDLQ = new Queue(stack, 'metrics-store-add-size-total-dlq')
  const metricsStoreAddSizeTotalConsumer = new Function(stack, 'metrics-store-add-size-total-consumer', {
    environment: {
      TABLE_NAME: adminMetricsTable.tableName
    },
    permissions: [adminMetricsTable],
    handler: 'functions/metrics-store-add-size-total.consumer',
    deadLetterQueue: metricsStoreAddSizeTotalDLQ.cdk.queue,
  })

  // metrics upload/add count
  const metricsUploadAddTotalDLQ = new Queue(stack, 'metrics-upload-add-total-dlq')
  const metricsUploadAddTotalConsumer = new Function(stack, 'metrics-upload-add-total-consumer', {
    environment: {
      TABLE_NAME: adminMetricsTable.tableName
    },
    permissions: [adminMetricsTable],
    handler: 'functions/metrics-upload-add-total.consumer',
    deadLetterQueue: metricsUploadAddTotalDLQ.cdk.queue,
  })

  // store/remove size
  const metricsStoreRemoveSizeTotalDLQ = new Queue(stack, 'metrics-store-remove-size-total-dlq')
  const metricsStoreRemoveSizeTotalConsumer = new Function(stack, 'metrics-store-remove-size-total-consumer', {
    environment: {
      TABLE_NAME: adminMetricsTable.tableName,
      STORE_BUCKET_NAME: carparkBucket.bucketName,
    },
    permissions: [adminMetricsTable, carparkBucket],
    handler: 'functions/metrics-store-remove-size-total.consumer',
    deadLetterQueue: metricsStoreRemoveSizeTotalDLQ.cdk.queue,
  })

  // metrics upload/remove count
  const metricsUploadRemoveTotalDLQ = new Queue(stack, 'metrics-upload-remove-total-dlq')
  const metricsUploadRemoveTotalConsumer = new Function(stack, 'metrics-upload-remove-total-consumer', {
    environment: {
      TABLE_NAME: adminMetricsTable.tableName
    },
    permissions: [adminMetricsTable],
    handler: 'functions/metrics-upload-remove-total.consumer',
    deadLetterQueue: metricsUploadRemoveTotalDLQ.cdk.queue,
  })
  
  // metrics per space
  const spaceMetricsDLQ = new Queue(stack, 'space-metrics-dlq')

  // upload/add count
  const spaceMetricsUploadAddTotalConsumer = new Function(stack, 'space-metrics-upload-add-total-consumer', {
    environment: {
      TABLE_NAME: spaceMetricsTable.tableName
    },
    permissions: [spaceMetricsTable],
    handler: 'functions/space-metrics-upload-add-total.consumer',
    deadLetterQueue: spaceMetricsDLQ.cdk.queue,
  })

  // store/add count
  const spaceMetricsStoreAddTotalConsumer = new Function(stack, 'space-metrics-store-add-total-consumer', {
    environment: {
      TABLE_NAME: spaceMetricsTable.tableName
    },
    permissions: [spaceMetricsTable],
    handler: 'functions/space-metrics-store-add-total.consumer',
    deadLetterQueue: spaceMetricsDLQ.cdk.queue,
  })

  // store/remove count
  const spaceMetricsStoreRemoveTotalConsumer = new Function(stack, 'space-metrics-store-remove-total-consumer', {
    environment: {
      TABLE_NAME: spaceMetricsTable.tableName
    },
    permissions: [spaceMetricsTable],
    handler: 'functions/space-metrics-store-remove-total.consumer',
    deadLetterQueue: spaceMetricsDLQ.cdk.queue,
  })

  // store/add size
  const spaceMetricsStoreAddSizeTotalConsumer = new Function(stack, 'space-metrics-store-add-size-total-consumer', {
    environment: {
      TABLE_NAME: spaceMetricsTable.tableName,
      STORE_BUCKET_NAME: carparkBucket.bucketName,
    },
    permissions: [spaceMetricsTable, carparkBucket],
    handler: 'functions/space-metrics-store-add-size-total.consumer',
    deadLetterQueue: spaceMetricsDLQ.cdk.queue,
  })

  // store/remove size
  const spaceMetricsStoreRemoveSizeTotalConsumer = new Function(stack, 'space-metrics-store-remove-size-total-consumer', {
    environment: {
      TABLE_NAME: spaceMetricsTable.tableName,
      STORE_BUCKET_NAME: carparkBucket.bucketName,
    },
    permissions: [spaceMetricsTable, carparkBucket],
    handler: 'functions/space-metrics-store-remove-size-total.consumer',
    deadLetterQueue: spaceMetricsDLQ.cdk.queue,
  })

  // create a kinesis stream
  const ucanStream = new KinesisStream(stack, 'ucan-stream', {
    cdk: {
      stream: {
        retentionPeriod: Duration.days(365)
      }
    },
    consumers: {
      metricsStoreAddTotalConsumer: {
        function: metricsStoreAddTotalConsumer,
        cdk: {
          eventSource: {
            ...(getKinesisEventSourceConfig(stack))
          }
        }
      },
      metricsStoreRemoveTotalConsumer: {
        function: metricsStoreRemoveTotalConsumer,
        cdk: {
          eventSource: {
            ...(getKinesisEventSourceConfig(stack))
          }
        }
      },
      metricsStoreAddSizeTotalConsumer: {
        function: metricsStoreAddSizeTotalConsumer,
        // TODO: Set kinesis filters when supported by SST
        // https://github.com/serverless-stack/sst/issues/1407
        cdk: {
          eventSource: {
            ...(getKinesisEventSourceConfig(stack))
          }
        }
      },
      metricsStoreRemoveSizeTotalConsumer: {
        function: metricsStoreRemoveSizeTotalConsumer,
        // TODO: Set kinesis filters when supported by SST
        // https://github.com/serverless-stack/sst/issues/1407
        cdk: {
          eventSource: {
            ...(getKinesisEventSourceConfig(stack))
          }
        }
      },
      metricsUploadAddTotalConsumer: {
        function: metricsUploadAddTotalConsumer,
        cdk: {
          eventSource: {
            ...(getKinesisEventSourceConfig(stack))
          }
        }
      },
      metricsUploadRemoveTotalConsumer: {
        function: metricsUploadRemoveTotalConsumer,
        cdk: {
          eventSource: {
            ...(getKinesisEventSourceConfig(stack))
          }
        }
      },
      spaceMetricsUploadAddTotalConsumer: {
        function: spaceMetricsUploadAddTotalConsumer,
        cdk: {
          eventSource: {
            ...(getKinesisEventSourceConfig(stack))
          }
        }
      },
      spaceMetricsStoreAddTotalConsumer: {
        function: spaceMetricsStoreAddTotalConsumer,
        // TODO: Set kinesis filters when supported by SST
        // https://github.com/serverless-stack/sst/issues/1407
        cdk: {
          eventSource: {
            ...(getKinesisEventSourceConfig(stack))
          }
        }
      },
      spaceMetricsStoreRemoveTotalConsumer: {
        function: spaceMetricsStoreRemoveTotalConsumer,
        // TODO: Set kinesis filters when supported by SST
        // https://github.com/serverless-stack/sst/issues/1407
        cdk: {
          eventSource: {
            ...(getKinesisEventSourceConfig(stack))
          }
        }
      },
      spaceMetricsStoreAddSizeTotalConsumer: {
        function: spaceMetricsStoreAddSizeTotalConsumer,
        // TODO: Set kinesis filters when supported by SST
        // https://github.com/serverless-stack/sst/issues/1407
        cdk: {
          eventSource: {
            ...(getKinesisEventSourceConfig(stack))
          }
        }
      },
      spaceMetricsStoreRemoveSizeTotalConsumer: {
        function: spaceMetricsStoreRemoveSizeTotalConsumer,
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
