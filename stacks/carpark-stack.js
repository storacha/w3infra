import {
  Bucket,
  Function,
  Queue,
  use
} from '@serverless-stack/resources'
import * as sqs from 'aws-cdk-lib/aws-sqs'

import { BusStack } from './bus-stack.js'
import { CARPARK_EVENT_BRIDGE_SOURCE_EVENT } from '../carpark/event-bus/source.js'
import { getConfig, setupSentry } from './config.js'

/**
 * @param {import('@serverless-stack/resources').StackContext} properties
 */
export function CarparkStack({ stack, app }) {
  stack.setDefaultFunctionProps({
    srcPath: 'carpark'
  })

  // @ts-expect-error "prod" | "dev" | "staging" only allowed for stage
  const stackConfig = getConfig(stack.stage)

  // Setup app monitoring with Sentry
  setupSentry(app, stack)

  // Get eventBus reference
  const { eventBus } = use(BusStack)

  const carparkBucket = new Bucket(stack, 'car-store', {
    ...stackConfig.carparkBucketConfig,
  })

  // Elastic IPFS event for indexing
  const indexerTopicQueue = new Queue(stack, 'indexer-topic-queue', {
    cdk: {
      queue: sqs.Queue.fromQueueArn(
        stack,
        'indexer-topic',
        'arn:aws:sqs:us-west-2:505595374361:indexer-topic'
      ),
    },
  })

  // Event Bus targets
  const eIpfsIndexTarget = {
    function: {
      environment: {},
      permissions: [indexerTopicQueue],
      handler: 'event-bus/eipfs-indexer.handler',
    },
  }

  eventBus.addRules(stack, {
    newCar: {
      pattern: {
        source: [CARPARK_EVENT_BRIDGE_SOURCE_EVENT],
      },
      targets: {
        eIpfsIndexTarget
      }
    }
  })

  // Trigger carpark events when a CAR is put into the bucket.
  const carparkPutEventConsumer = new Function(stack, 'carpark-consumer', {
    environment: {
      EVENT_BUS_ARN: eventBus.eventBusArn,
    },
    permissions: [eventBus],
    handler: 'functions/carpark-bucket-event.carparkBucketConsumer',
  })
  carparkBucket.addNotifications(stack, {
    newCarPut: {
      function: carparkPutEventConsumer,
      events: ['object_created_put'],
    }
  })

  return {
    carparkBucket
  }
}
