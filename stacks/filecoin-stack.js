import {
  Function,
  Queue,
  use,
} from '@serverless-stack/resources'
import { Duration, aws_events as awsEvents } from 'aws-cdk-lib'

import { BusStack } from './bus-stack.js'
import { CarparkStack } from './carpark-stack.js'
import { UploadDbStack } from './upload-db-stack.js'
import { setupSentry } from './config.js'
import { CARPARK_EVENT_BRIDGE_SOURCE_EVENT } from '../carpark/event-bus/source.js'

/**
 * @param {import('@serverless-stack/resources').StackContext} properties
 */
export function FilecoinStack({ stack, app }) {
  stack.setDefaultFunctionProps({
    srcPath: 'filecoin'
  })

  // Setup app monitoring with Sentry
  setupSentry(app, stack)

  // Get carpark reference
  const { carparkBucket } = use(CarparkStack)
  // Get eventBus reference
  const { eventBus } = use(BusStack)
  // Get store table reference
  const { pieceTable } = use(UploadDbStack)

  // piece-cid compute
  const pieceCidComputeHandler = new Function(
    stack,
    'piece-cid-compute-handler',
    {
      environment : {
        PIECE_TABLE_NAME: pieceTable.tableName,
      },
      permissions: [pieceTable, carparkBucket],
      handler: 'functions/piece-cid-compute.handler',
      timeout: 15 * 60,
    },
  )

  const pieceCidComputeQueue = new Queue(stack, 'piece-cid-compute-queue', {
    consumer: {
      function: pieceCidComputeHandler,
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
  const targetPieceCidComputeQueue = {
    type: 'queue',
    queue: pieceCidComputeQueue,
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
    newCarToComputePiece: {
      pattern: {
        source: [CARPARK_EVENT_BRIDGE_SOURCE_EVENT],
      },
      targets: {
        targetPieceCidComputeQueue
      }
    }
  })
}
