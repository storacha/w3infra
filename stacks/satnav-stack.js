import {
  Bucket,
  Function,
  Queue,
  use,
} from '@serverless-stack/resources'
import { Duration, aws_events as awsEvents } from 'aws-cdk-lib'

import { BusStack } from './bus-stack.js'
import { CarparkStack } from './carpark-stack.js'
import { getConfig } from './config.js'
import { CARPARK_EVENT_BRIDGE_SOURCE_EVENT } from '../carpark/event-bus/source.js'

/**
 * @param {import('@serverless-stack/resources').StackContext} properties
 */
export function SatnavStack({ stack }) {
  stack.setDefaultFunctionProps({
    srcPath: 'satnav'
  })

  // @ts-expect-error "prod" | "dev" | "staging" only allowed for stage
  const stackConfig = getConfig(stack.stage)

  // Get carpark reference
  const { carparkBucket } = use(CarparkStack)
  // Get eventBus reference
  const { eventBus } = use(BusStack)

  const satnavBucket = new Bucket(stack, 'satnav-store', {
    ...stackConfig.satnavBucketConfig,
  })

   // Side Index creation and write to Satnav
   const satnavWriterHandler = new Function(
    stack,
    'satnav-writer-handler',
    {
      environment : {

      },
      permissions: [satnavBucket, carparkBucket],
      handler: 'functions/satnav-writer.handler',
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

  /** @type {import('@serverless-stack/resources').EventBusQueueTargetProps} */
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
    handler: 'functions/satnav-bucket-event.satnavBucketConsumer',
  })
  satnavBucket.addNotifications(stack, {
    newCarPut: {
      function: satnavPutEventConsumer,
      events: ['object_created_put'],
    }
  })
}
