import {
  Api,
  Config,
  Function,
  Queue,
  Table,
  use
} from 'sst/constructs'
import * as sqs from 'aws-cdk-lib/aws-sqs'
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb'

import { StartingPosition } from 'aws-cdk-lib/aws-lambda'
import { UploadDbStack } from './upload-db-stack.js'
import { BillingDbStack } from './billing-db-stack.js'
import { CarparkStack } from './carpark-stack.js'
import { FilecoinStack } from './filecoin-stack.js'
import { UcanInvocationStack } from './ucan-invocation-stack.js'

import { getCustomDomain, getApiPackageJson, getGitInfo, setupSentry, getEnv, getEventSourceConfig, getServiceURL } from './config.js'

/**
 * @param {import('sst/constructs').StackContext} properties
 */
export function UploadApiStack({ stack, app }) {
  const { AGGREGATOR_DID, EIPFS_MULTIHASHES_SQS_ARN, EIPFS_BLOCKS_CAR_POSITION_TABLE_ARN } = getEnv()

  // Setup app monitoring with Sentry
  setupSentry(app, stack)

  // Get references to constructs created in other stacks
  const { carparkBucket } = use(CarparkStack)
  const { allocationTable, storeTable, uploadTable, delegationBucket, delegationTable, revocationTable, adminMetricsTable, spaceMetricsTable, consumerTable, subscriptionTable, rateLimitTable, pieceTable, privateKey } = use(UploadDbStack)
  const { invocationBucket, taskBucket, workflowBucket, ucanStream } = use(UcanInvocationStack)
  const { customerTable, spaceDiffTable, spaceSnapshotTable, stripeSecretKey } = use(BillingDbStack)
  const { pieceOfferQueue, filecoinSubmitQueue } = use(FilecoinStack)

  // Blob protocol
  // Elastic IPFS event for multihashes
  const multihashesQueue = new Queue(stack, 'multihashes-topic-queue', {
    cdk: {
      queue: sqs.Queue.fromQueueArn(
        stack,
        'multihashes-topic',
        EIPFS_MULTIHASHES_SQS_ARN
      ),
    },
  })

  const blocksCarPositionTable = new Table(stack, 'blocks-car-position-table', {
    cdk: {
      table: dynamodb.Table.fromTableArn(
        stack,
        'blocks-car-position',
        EIPFS_BLOCKS_CAR_POSITION_TABLE_ARN
      ),
    },
  })

  // Setup API
  const customDomain = getCustomDomain(stack.stage, process.env.HOSTED_ZONE)
  const pkg = getApiPackageJson()
  const git = getGitInfo()
  const ucanInvocationPostbasicAuth = new Config.Secret(stack, 'UCAN_INVOCATION_POST_BASIC_AUTH')
  // https://docs.aws.amazon.com/IAM/latest/UserGuide/reference-arns.html#arns-syntax
  const indexerRegion = EIPFS_MULTIHASHES_SQS_ARN.split(':')[3]

  const api = new Api(stack, 'http-gateway', {
    customDomain,
    defaults: {
      function: {
        timeout: '30 seconds',
        permissions: [
          allocationTable,
          storeTable,
          uploadTable,
          customerTable,
          delegationTable,
          revocationTable,
          delegationBucket,
          consumerTable,
          subscriptionTable,
          rateLimitTable,
          adminMetricsTable,
          spaceMetricsTable,
          pieceTable,
          spaceDiffTable,
          spaceSnapshotTable,
          carparkBucket,
          invocationBucket,
          taskBucket,
          workflowBucket,
          ucanStream,
          pieceOfferQueue,
          filecoinSubmitQueue,
          multihashesQueue,
          blocksCarPositionTable,
        ],
        environment: {
          DID: process.env.UPLOAD_API_DID ?? '',
          AGGREGATOR_DID,
          ALLOCATION_TABLE_NAME: allocationTable.tableName,
          STORE_TABLE_NAME: storeTable.tableName,
          STORE_BUCKET_NAME: carparkBucket.bucketName,
          UPLOAD_TABLE_NAME: uploadTable.tableName,
          CONSUMER_TABLE_NAME: consumerTable.tableName,
          CUSTOMER_TABLE_NAME: customerTable.tableName,
          SUBSCRIPTION_TABLE_NAME: subscriptionTable.tableName,
          SPACE_METRICS_TABLE_NAME: spaceMetricsTable.tableName,
          RATE_LIMIT_TABLE_NAME: rateLimitTable.tableName,
          DELEGATION_TABLE_NAME: delegationTable.tableName,
          REVOCATION_TABLE_NAME: revocationTable.tableName,
          SPACE_DIFF_TABLE_NAME: spaceDiffTable.tableName,
          SPACE_SNAPSHOT_TABLE_NAME: spaceSnapshotTable.tableName,
          DELEGATION_BUCKET_NAME: delegationBucket.bucketName,
          INVOCATION_BUCKET_NAME: invocationBucket.bucketName,
          TASK_BUCKET_NAME: taskBucket.bucketName,
          WORKFLOW_BUCKET_NAME: workflowBucket.bucketName,
          UCAN_LOG_STREAM_NAME: ucanStream.streamName,
          ADMIN_METRICS_TABLE_NAME: adminMetricsTable.tableName,
          PIECE_TABLE_NAME: pieceTable.tableName,
          PIECE_OFFER_QUEUE_URL: pieceOfferQueue.queueUrl,
          FILECOIN_SUBMIT_QUEUE_URL: filecoinSubmitQueue.queueUrl,
          MULTIHASHES_QUEUE_URL: multihashesQueue.queueUrl,
          BLOCKS_CAR_POSITION_TABLE_NAME: blocksCarPositionTable.tableName,
          NAME: pkg.name,
          VERSION: pkg.version,
          COMMIT: git.commmit,
          STAGE: stack.stage,
          ACCESS_SERVICE_URL: getServiceURL(stack, customDomain) ?? '',
          UPLOAD_SERVICE_URL: getServiceURL(stack, customDomain) ?? '',
          POSTMARK_TOKEN: process.env.POSTMARK_TOKEN ?? '',
          PROVIDERS: process.env.PROVIDERS ?? '',
          R2_ACCESS_KEY_ID: process.env.R2_ACCESS_KEY_ID ?? '',
          R2_SECRET_ACCESS_KEY: process.env.R2_SECRET_ACCESS_KEY ?? '',
          R2_REGION: process.env.R2_REGION ?? '',
          R2_CARPARK_BUCKET_NAME: process.env.R2_CARPARK_BUCKET_NAME ?? '',
          R2_DUDEWHERE_BUCKET_NAME: process.env.R2_DUDEWHERE_BUCKET_NAME ?? '',
          R2_DELEGATION_BUCKET_NAME: process.env.R2_DELEGATION_BUCKET_NAME ?? '',
          R2_ENDPOINT: process.env.R2_ENDPOINT ?? '',
          REQUIRE_PAYMENT_PLAN: process.env.REQUIRE_PAYMENT_PLAN ?? '',
          UPLOAD_API_DID: process.env.UPLOAD_API_DID ?? '',
          STRIPE_PRICING_TABLE_ID: process.env.STRIPE_PRICING_TABLE_ID ?? '',
          STRIPE_PUBLISHABLE_KEY: process.env.STRIPE_PUBLISHABLE_KEY ?? '',
          DEAL_TRACKER_DID: process.env.DEAL_TRACKER_DID ?? '',
          DEAL_TRACKER_URL: process.env.DEAL_TRACKER_URL ?? '',
          INDEXER_REGION: indexerRegion
        },
        bind: [
          privateKey,
          ucanInvocationPostbasicAuth,
          stripeSecretKey
        ]
      }
    },
    routes: {
      'POST /':       'upload-api/functions/ucan-invocation-router.handler',
      'POST /ucan':   'upload-api/functions/ucan.handler',
      'POST /bridge': 'upload-api/functions/bridge.handler',
      'GET /':        'upload-api/functions/get.home',
      'GET /validate-email': 'upload-api/functions/validate-email.preValidateEmail',
      'POST /validate-email': 'upload-api/functions/validate-email.validateEmail',
      'GET /error':   'upload-api/functions/get.error',
      'GET /version': 'upload-api/functions/get.version',
      'GET /metrics': 'upload-api/functions/metrics.handler',
      'GET /receipt/{taskCid}': 'upload-api/functions/receipt.handler',
      'GET /storefront-cron': 'upload-api/functions/storefront-cron.handler',
      // AWS API Gateway does not know trailing slash... and Grafana Agent puts trailing slash
      'GET /metrics/{proxy+}': 'upload-api/functions/metrics.handler',
    },
    accessLog: {
      format:'{"requestTime":"$context.requestTime","requestId":"$context.requestId","httpMethod":"$context.httpMethod","path":"$context.path","routeKey":"$context.routeKey","status":$context.status,"responseLatency":$context.responseLatency,"integrationRequestId":"$context.integration.requestId","integrationStatus":"$context.integration.status","integrationLatency":"$context.integration.latency","integrationServiceStatus":"$context.integration.integrationStatus","ip":"$context.identity.sourceIp","userAgent":"$context.identity.userAgent"}'
    }
  })

  // UCAN stream metrics for admin and space
  const uploadAdminMetricsDLQ = new Queue(stack, 'upload-admin-metrics-dlq')
  const uploadAdminMetricsConsumer = new Function(stack, 'upload-admin-metrics-consumer', {
    environment: {
      ADMIN_METRICS_TABLE_NAME: adminMetricsTable.tableName,
      STORE_BUCKET_NAME: carparkBucket.bucketName,
      ALLOCATION_TABLE_NAME: allocationTable.tableName
    },
    permissions: [adminMetricsTable, carparkBucket, allocationTable],
    handler: 'upload-api/functions/admin-metrics.consumer',
    deadLetterQueue: uploadAdminMetricsDLQ.cdk.queue,
  })

  const uploadSpaceMetricsDLQ = new Queue(stack, 'upload-space-metrics-dlq')
  const uploadSpaceMetricsConsumer = new Function(stack, 'upload-space-metrics-consumer', {
    environment: {
      SPACE_METRICS_TABLE_NAME: spaceMetricsTable.tableName,
      STORE_BUCKET_NAME: carparkBucket.bucketName,
      ALLOCATION_TABLE_NAME: allocationTable.tableName
    },
    permissions: [spaceMetricsTable, carparkBucket, allocationTable],
    handler: 'upload-api/functions/space-metrics.consumer',
    deadLetterQueue: uploadSpaceMetricsDLQ.cdk.queue,
  })

  ucanStream.addConsumers(stack, {
    uploadAdminMetricsConsumer: {
      function: uploadAdminMetricsConsumer,
      cdk: {
        eventSource: {
          ...(getEventSourceConfig(stack)),
          // Override where to begin consuming the stream to latest as we already are reading from this stream
          startingPosition: StartingPosition.LATEST
        }
      }
    },
    uploadSpaceMetricsConsumer: {
      function: uploadSpaceMetricsConsumer,
      cdk: {
        eventSource: {
          ...(getEventSourceConfig(stack)),
          // Override where to begin consuming the stream to latest as we already are reading from this stream
          startingPosition: StartingPosition.LATEST
        }
      }
    },
  })

  stack.addOutputs({
    ApiEndpoint: api.url,
    CustomDomain:  customDomain ? `https://${customDomain.domainName}` : 'Set HOSTED_ZONE in env to deploy to a custom domain'
  })
}
