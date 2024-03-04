import {
  Function,
  Queue,
  use
} from 'sst/constructs'
import { Duration, aws_events as awsEvents } from 'aws-cdk-lib'
import { BusStack } from './bus-stack.js'

import { setupSentry } from './config.js'
import { CARPARK_EVENT_BRIDGE_SOURCE_EVENT } from '../carpark/event-bus/source.js'
import { SATNAV_EVENT_BRIDGE_SOURCE_EVENT } from '../satnav/event-bus/source.js'

/**
 * @param {import('sst/constructs').StackContext} properties
 */
export function ReplicatorStack({ stack, app }) {
  // Setup app monitoring with Sentry
  setupSentry(app, stack)

  // Get Event Bus reference
  const { eventBus } = use(BusStack)

  // CAR replicator lambda
  const carparkReplicatorHandler = new Function(
    stack,
    'carpark-replicator-handler',
    {
      environment: {
        REPLICATOR_ACCESS_KEY_ID: process.env.R2_ACCESS_KEY_ID || '',
        REPLICATOR_ENDPOINT: process.env.R2_ENDPOINT || '',
        REPLICATOR_SECRET_ACCESS_KEY:
          process.env.R2_SECRET_ACCESS_KEY || '',
        REPLICATOR_BUCKET_NAME: process.env.R2_CARPARK_BUCKET_NAME || '',
      },
      permissions: ['s3:*'],
      handler: 'replicator/functions/replicator.handler',
      timeout: 15 * 60,
    }
  )

  // Satnav replicator lambda
  const satnavReplicatorHandler = new Function(
    stack,
    'satnav-replicator-handler',
    {
      environment: {
        REPLICATOR_ACCESS_KEY_ID: process.env.R2_ACCESS_KEY_ID || '',
        REPLICATOR_ENDPOINT: process.env.R2_ENDPOINT || '',
        REPLICATOR_SECRET_ACCESS_KEY:
          process.env.R2_SECRET_ACCESS_KEY || '',
        REPLICATOR_BUCKET_NAME: process.env.R2_SATNAV_BUCKET_NAME || '',
      },
      permissions: ['s3:*'],
      handler: 'replicator/functions/replicator.handler',
      timeout: 15 * 60,
    }
  )

  // Queues
  const carReplicatorQueue = new Queue(stack, 'car-replicator-queue', {
    consumer: {
      function: carparkReplicatorHandler,
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

  const satnavReplicatorQueue = new Queue(stack, 'satnav-replicator-queue', {
    consumer: {
      function: satnavReplicatorHandler,
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

  // Event Bus Targets
  const targetMessage = awsEvents.RuleTargetInput.fromObject({
    bucketRegion: awsEvents.EventField.fromPath('$.detail.region'),
    bucketName: awsEvents.EventField.fromPath('$.detail.bucketName'),
    key: awsEvents.EventField.fromPath('$.detail.key')
  })

  /** @type {import('sst/constructs').EventBusQueueTargetProps} */
  const carTargetReplicatorQueue = {
    type: 'queue',
    queue: carReplicatorQueue,
    cdk: {
      target: {
        message: targetMessage,
      },
    }
  }

  /** @type {import('sst/constructs').EventBusQueueTargetProps} */
  const satnavTargetReplicatorQueue = {
    type: 'queue',
    queue: satnavReplicatorQueue,
    cdk: {
      target: {
        message: targetMessage,
      },
    }
  }

  // Replicate CARPARK, SATNAV AND UCAN write events
  eventBus.addRules(stack, {
    newCarToReplicate: {
      pattern: {
        source: [CARPARK_EVENT_BRIDGE_SOURCE_EVENT],
      },
      targets: {
        carTargetReplicatorQueue
      }
    },
    newSatnavIndexToReplicate: {
      pattern: {
        source: [SATNAV_EVENT_BRIDGE_SOURCE_EVENT],
      },
      targets: {
        satnavTargetReplicatorQueue
      }
    }
  })
}
