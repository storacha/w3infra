import {
  Bucket,
  Function,
  Queue,
  use,
} from 'sst/constructs'
import { Duration, aws_events as awsEvents } from 'aws-cdk-lib'

import { BusStack } from './bus-stack.js'
import { CarparkStack } from './carpark-stack.js'
import { getBucketConfig, setupSentry } from './config.js'
import { CARPARK_EVENT_BRIDGE_SOURCE_EVENT } from '../carpark/event-bus/source.js'

/**
 * @param {import('sst/constructs').StackContext} properties
 */
export function SatnavStack({ stack, app }) {
  // Setup app monitoring with Sentry
  setupSentry(app, stack)

  // Get carpark reference
  const { carparkBucket } = use(CarparkStack)
  // Get eventBus reference
  const { eventBus } = use(BusStack)

  const satnavBucket = new Bucket(stack, 'satnav-store', {
    cdk: {
      bucket: getBucketConfig('satnav', app.stage)
    }
  })

   // Side Index creation and write to Satnav
   const satnavWriterHandler = new Function(
    stack,
    'satnav-writer-handler',
    {
      environment : {
        SATNAV_BUCKET_NAME: satnavBucket.bucketName
      },
      permissions: [satnavBucket, carparkBucket],
      handler: 'satnav/functions/satnav-writer.handler',
      timeout: 15 * 60,
    },
  )

  const satnavWriterQueue = new Queue(stack, 'satnav-writer-queue', {
    consumer: {
      function: satnavWriterHandler,
      cdk: {
        eventSource: {
          batchSize: 1,
        },
      }
    },
    cdk: {
      queue: {
        // Needs to be set as less or equal than consumer function
        visibilityTimeout: Duration.seconds(15 * 60),
      },
    },
  })

  /** @type {import('sst/constructs').EventBusQueueTargetProps} */
  const targetSatnavWriterQueue = {
    type: 'queue',
    queue: satnavWriterQueue,
    cdk: {
      target: {
        message: awsEvents.RuleTargetInput.fromObject({
          bucketRegion: awsEvents.EventField.fromPath('$.detail.region'),
          bucketName: awsEvents.EventField.fromPath('$.detail.bucketName'),
          key: awsEvents.EventField.fromPath('$.detail.key')
        }),
      },
    }
  }

  eventBus.addRules(stack, {
    newCarToWriteSatnav: {
      pattern: {
        source: [CARPARK_EVENT_BRIDGE_SOURCE_EVENT],
      },
      targets: {
        targetSatnavWriterQueue,
      }
    }
  })

  // Trigger satnav events when an Index is put into the bucket
  const satnavPutEventConsumer = new Function(stack, 'satnav-consumer', {
    environment: {
      EVENT_BUS_ARN: eventBus.eventBusArn,
    },
    permissions: [eventBus],
    handler: 'satnav/functions/satnav-bucket-event.satnavBucketConsumer',
  })
  satnavBucket.addNotifications(stack, {
    newCarPut: {
      function: satnavPutEventConsumer,
      events: ['object_created_put'],
    }
  })

  stack.addOutputs({
    BucketName: satnavBucket.bucketName,
    Region: stack.region
  })
}
