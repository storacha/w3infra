import {
  Bucket,
  Function,
  Queue,
  use
} from '@serverless-stack/resources'
import { Duration } from 'aws-cdk-lib'

import { CarparkStack } from './carpark-stack.js'
import { getConfig } from './config.js'
import { CARPARK_EVENT_BRIDGE_SOURCE_EVENT } from '../carpark/event-bridge/index.js'

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
  const { carparkBucket, carparkEventBus } = use(CarparkStack)

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

  const satnavWriterTarget = {
    function: {
      environment: {
        SQS_SATNAV_WRITER_QUEUE_URL: satnavWriterQueue.queueUrl,
      },
      permissions: [satnavWriterQueue],
      handler: 'events/satnav-writer.handler',
    },
  }

  carparkEventBus.addRules(stack, {
    newCarToWriteSatnav: {
      pattern: {
        source: [CARPARK_EVENT_BRIDGE_SOURCE_EVENT],
      },
      targets: {
        satnavWriterTarget
      }
    }
  })

  // Trigger satnav events when an Index is put into the bucket
  // TODO: this needs replicator-stack because of circular dependency stack
  /*
  const satnavPutEventConsumer = new Function(stack, 'satnav-consumer', {
    environment: {
      CARPARK_BUS_ARN: carparkEventBus.eventBusArn,
    },
    permissions: [carparkEventBus],
    handler: 'functions/satnav-event.satnavBucketConsumer',
  })
  satnavBucket.addNotifications(stack, {
    newCarPut: {
      function: satnavPutEventConsumer,
      events: ['object_created_put'],
    }
  })
  */
}
