import {
  Bucket,
  Function,
  Queue,
  use
} from 'sst/constructs'
import * as sqs from 'aws-cdk-lib/aws-sqs'
import * as iam from 'aws-cdk-lib/aws-iam'

import { BusStack } from './bus-stack.js'
import { CARPARK_EVENT_BRIDGE_SOURCE_EVENT } from '../carpark/event-bus/source.js'
import { getBucketConfig, getCdkNames, isPrBuild, setupSentry } from './config.js'

/**
 * @param {import('sst/constructs').StackContext} properties
 */
export function CarparkStack({ stack, app }) {
  // Setup app monitoring with Sentry
  setupSentry(app, stack)

  // Get eventBus reference
  const { eventBus } = use(BusStack)
  const { EIPFS_INDEXER_SQS_ARN, EIPFS_INDEXER_SQS_URL } = getEnv()

  const carparkBucket = new Bucket(stack, 'car-store', {
    cors: true,
    cdk: {
      bucket: getBucketConfig('carpark', app.stage)
    }
  })

  // In PRs, the indexer lambda does not have access to the new bucket.
  if (isPrBuild(app.stage)) {
    const EIPFS_INDEXER_LAMBDA_ARN = mustGetEnv('EIPFS_INDEXER_LAMBDA_ARN')

    const carparkRoleName = getCdkNames('carpark-bucket-role', app.stage)
    const carparkRole = new iam.Role(stack, carparkRoleName, {
      assumedBy: new iam.ArnPrincipal(EIPFS_INDEXER_LAMBDA_ARN),
      roleName: carparkRoleName
    })

    const policyName = getCdkNames('carpark-bucket-policy', app.stage)
    new iam.Policy(stack, policyName, {
      policyName,
      roles: [carparkRole],
      statements: [
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          resources: [
            carparkBucket.bucketArn,
            `${carparkBucket.bucketArn}/*`
          ],
          actions: ['s3:GetObject']
        })
      ]
    })
  }

  // Elastic IPFS event for indexing
  const indexerTopicQueue = new Queue(stack, 'indexer-topic-queue', {
    cdk: {
      queue: sqs.Queue.fromQueueArn(
        stack,
        'indexer-topic',
        EIPFS_INDEXER_SQS_ARN
      ),
    },
  })

  // Event Bus targets
  const eIpfsIndexTarget = {
    function: {
      environment: {
        EIPFS_INDEXER_SQS_URL
      },
      permissions: [indexerTopicQueue],
      handler: 'carpark/event-bus/eipfs-indexer.handler',
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
    handler: 'carpark/functions/carpark-bucket-event.carparkBucketConsumer',
  })
  carparkBucket.addNotifications(stack, {
    newCarPut: {
      function: carparkPutEventConsumer,
      events: ['object_created'],
    }
  })

  stack.addOutputs({
    BucketName: carparkBucket.bucketName,
    Region: stack.region
  })

  return {
    carparkBucket
  }
}

/**
 * Get Env validating it is set.
 */
function getEnv() {
  return {
    EIPFS_INDEXER_SQS_ARN: mustGetEnv('EIPFS_INDEXER_SQS_ARN'),
    EIPFS_INDEXER_SQS_URL: mustGetEnv('EIPFS_INDEXER_SQS_URL'),
  }
}

/**
 * 
 * @param {string} name 
 * @returns {string}
 */
function mustGetEnv (name) {
  if (!process.env[name]) {
    throw new Error(`Missing env var: ${name}`)
  }

  // @ts-expect-error there will always be a string there, but typescript does not believe
  return process.env[name]
}
