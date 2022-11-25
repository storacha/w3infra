import {
  Bucket,
  Function,
  Queue,
  EventBus
} from '@serverless-stack/resources'
import { Duration } from 'aws-cdk-lib'
import * as sqs from 'aws-cdk-lib/aws-sqs'

import { CARPARK_EVENT_BRIDGE_SOURCE_EVENT } from '../carpark/event-bridge/index.js'

import { getConfig } from './config.js'

/**
 * @param {import('@serverless-stack/resources').StackContext} properties
 */
export function CarparkStack({ stack }) {
  stack.setDefaultFunctionProps({
    srcPath: 'carpark'
  })

  // @ts-expect-error "prod" | "dev" | "staging" only allowed for stage
  const stackConfig = getConfig(stack.stage)

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

  // CAR files and Side indexes replicator
  const replicatorHandler = new Function(
    stack,
    'replicator-handler',
    {
      environment: {
        REPLICATOR_ACCOUNT_ID: process.env.REPLICATOR_ACCOUNT_ID || '',
        REPLICATOR_ACCESS_KEY_ID: process.env.REPLICATOR_ACCESS_KEY_ID || '',
        REPLICATOR_SECRET_ACCESS_KEY:
          process.env.REPLICATOR_SECRET_ACCESS_KEY || '',
        REPLICATOR_CAR_BUCKET_NAME: process.env.REPLICATOR_CAR_BUCKET_NAME || '',
        REPLICATOR_INDEX_BUCKET_NAME:
          process.env.REPLICATOR_INDEX_BUCKET_NAME || '',
      },
      permissions: ['s3:*'],
      handler: 'functions/replicator.handler',
      timeout: 15 * 60,
    }
  )

  const replicatorQueue = new Queue(stack, 'replicator-queue', {
    consumer: {
      function: replicatorHandler,
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

  // Event Bus targets
  const eIpfsIndexTarget = {
    function: {
      environment: {},
      permissions: [indexerTopicQueue],
      handler: 'event-bridge/eipfs-indexer.handler',
    },
  }

  const replicatorTarget = {
    function: {
      environment: {
        SQS_REPLICATOR_QUEUE_URL: replicatorQueue.queueUrl,
      },
      permissions: [replicatorQueue],
      handler: 'event-bridge/replicator.handler',
    },
  }

  const carparkEventBus = new EventBus(stack, 'carpark-event-bus', {
    rules: {
      newCar: {
        pattern: {
          source: [CARPARK_EVENT_BRIDGE_SOURCE_EVENT],
        },
        targets: {
          eIpfsIndexTarget,
          replicatorTarget
        },
      },
    }
  })

  // Trigger carpark events when a CAR is put into the bucket.
  const carparkPutEventConsumer = new Function(stack, 'carpark-consumer', {
    environment: {
      CARPARK_BUS_ARN: carparkEventBus.eventBusArn,
    },
    permissions: [carparkEventBus],
    handler: 'functions/carpark-event.carparkBucketConsumer',
  })
  carparkBucket.addNotifications(stack, {
    newCarPut: {
      function: carparkPutEventConsumer,
      events: ['object_created_put'],
    }
  })

  return {
    carparkBucket,
    carparkEventBus
  }
}
