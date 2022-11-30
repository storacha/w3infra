import {
  Bucket,
  Function,
  Queue,
  use
} from '@serverless-stack/resources'
import { Duration, aws_events as awsEvents } from 'aws-cdk-lib'
import * as sqs from 'aws-cdk-lib/aws-sqs'

import { BusStack } from './bus-stack.js'
import { CARPARK_EVENT_BRIDGE_SOURCE_EVENT } from '../carpark/event-bus/source.js'
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
      handler: 'event-bus/eipfs-indexer.handler',
    },
  }

  /** @type {import('@serverless-stack/resources').EventBusQueueTargetProps} */
  const targetReplicatorQueue = {
    type: 'queue',
    queue: replicatorQueue,
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
    newCar: {
      pattern: {
        source: [CARPARK_EVENT_BRIDGE_SOURCE_EVENT],
      },
      targets: {
        eIpfsIndexTarget,
        targetReplicatorQueue
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
