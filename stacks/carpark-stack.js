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

  // carpark backup and index for Freeway
  const carBackupAndIndexHandler = new Function(
    stack,
    'car-backup-and-index-handler',
    {
      environment: {
        BACKUP_ACCOUNT_ID: process.env.BACKUP_ACCOUNT_ID || '',
        BACKUP_ACCESS_KEY_ID: process.env.BACKUP_ACCESS_KEY_ID || '',
        BACKUP_SECRET_ACCESS_KEY:
          process.env.BACKUP_SECRET_ACCESS_KEY || '',
        BACKUP_CAR_BUCKET_NAME: process.env.BACKUP_CAR_BUCKET_NAME || '',
        BACKUP_INDEX_BUCKET_NAME:
          process.env.BACKUP_INDEX_BUCKET_NAME || '',
      },
      permissions: ['s3:*'],
      handler: 'functions/car-backup-and-index.handler',
      timeout: 15 * 60,
    }
  )

  const carBackupAndIndexQueue = new Queue(stack, 'car-backup-and-index-queue', {
    consumer: {
      function: carBackupAndIndexHandler,
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

  const carBackupAndIndexTarget = {
    function: {
      environment: {
        SQS_BACKUP_AND_INDEX_QUEUE_URL: carBackupAndIndexQueue.queueUrl,
      },
      permissions: [carBackupAndIndexQueue],
      handler: 'carpark/event-bridge/car-backup-and-index.handler',
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
          carBackupAndIndexTarget,
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
