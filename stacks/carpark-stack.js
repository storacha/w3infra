import {
  Bucket,
  Function,
  Queue,
  EventBus
} from '@serverless-stack/resources'
import { Duration } from 'aws-cdk-lib'
import * as sqs from 'aws-cdk-lib/aws-sqs'

import { CARPARK_EVENT_BRIDGE_SOURCE_EVENT } from '../api/carpark/event-bridge/index.js'

import { getConfig } from './config.js'

/**
 * @param {import('@serverless-stack/resources').StackContext} properties
 */
export function CarparkStack({ stack }) {
  // @ts-expect-error "prod" | "dev" | "staging" only allowed for stage
  const stackConfig = getConfig(stack.stage)

  const carparkBucket = new Bucket(stack, 'car-store', {
    ...stackConfig.bucketConfig,
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

  // carpark replicator and index for Freeway
  const carReplicatorAndIndexHandler = new Function(
    stack,
    'car-replicator-and-index-handler',
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
      handler: 'functions/car-replicator-and-index.handler',
      timeout: 15 * 60,
    }
  )

  const carReplicatorAndIndexQueue = new Queue(stack, 'car-replicator-and-index-queue', {
    consumer: {
      function: carReplicatorAndIndexHandler,
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
      handler: 'carpark/event-bridge/eipfs-indexer.handler',
    },
  }

  const carReplicatorAndIndexTarget = {
    function: {
      environment: {
        SQS_REPLICATOR_AND_INDEX_QUEUE_URL: carReplicatorAndIndexQueue.queueUrl,
      },
      permissions: [carReplicatorAndIndexQueue],
      handler: 'carpark/event-bridge/car-replicator-and-index.handler',
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
          carReplicatorAndIndexTarget,
        },
      }
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
    carparkBucket
  }
}
