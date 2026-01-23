import { Api, Config, Function, Queue, use } from 'sst/constructs'
import * as iam from 'aws-cdk-lib/aws-iam'

import {
  StartingPosition,
  FilterCriteria,
  FilterRule,
} from 'aws-cdk-lib/aws-lambda'
import { UploadDbStack } from './upload-db-stack.js'
import { BillingDbStack } from './billing-db-stack.js'
import { BillingStack } from './billing-stack.js'
import { CarparkStack } from './carpark-stack.js'
import { FilecoinStack } from './filecoin-stack.js'
import { UcanInvocationStack } from './ucan-invocation-stack.js'
import { IndexerStack } from './indexer-stack.js'
import {
  getCustomDomain,
  getApiPackageJson,
  getGitInfo,
  setupSentry,
  getEnv,
  getEventSourceConfig,
  getServiceURL,
} from './config.js'

/**
 * @param {import('sst/constructs').StackContext} properties
 */
export function UploadApiStack({ stack, app }) {
  // For loading the Storacha logo
  stack.setDefaultFunctionProps({
    nodejs: {
      esbuild: {
        loader: {
          '.svg': 'text',
        },
      },
    },
  })

  const {
    AGGREGATOR_DID,
    DISABLE_IPNI_PUBLISHING,
  } = getEnv()

  // Setup app monitoring with Sentry
  setupSentry(app, stack)

  // Get references to constructs created in other stacks
  const { carparkBucket } = use(CarparkStack)
  const {
    allocationTable,
    blobRegistryTable,
    humanodeTable,
    storeTable,
    uploadTable,
    delegationBucket,
    delegationTable,
    revocationTable,
    adminMetricsTable,
    spaceMetricsTable,
    consumerTable,
    subscriptionTable,
    storageProviderTable,
    replicaTable,
    rateLimitTable,
    pieceTable,
    uploadShardsBucket,
    privateKey,
    contentClaimsPrivateKey,
    indexingServiceProof,
    dealTrackerServiceProof,
    githubClientSecret,
    humanodeClientSecret,
    dmailApiKey,
    dmailApiSecret,
    dmailJwtSecret,
  } = use(UploadDbStack)

  // SSM parameter ARNs for runtime loading (avoids Lambda env var size limits)
  // The Lambda functions will load these from SSM at cold start
  const ssmParameterArns = [
    `arn:aws:ssm:*:*:parameter/sst/${app.name}/${app.stage}/Parameter/*`,
  ]
  const { agentIndexTable, agentIndexBucket, agentMessageBucket, ucanStream } =
    use(UcanInvocationStack)
  const {
    customerTable,
    spaceDiffTable,
    spaceSnapshotTable,
    egressTrafficTable,
    stripeSecretKey,
  } = use(BillingDbStack)
  const { aggregatorServiceProof, pieceOfferQueue, filecoinSubmitQueue } =
    use(FilecoinStack)
  /** @type {{ permissions: import('sst/constructs').Permissions, environment: Record<string, string> } | undefined} */
  let ipniConfig
  if (DISABLE_IPNI_PUBLISHING !== 'true') {
    const { blockAdvertPublisherQueue, blockIndexWriterQueue } =
      use(IndexerStack)
    ipniConfig = {
      permissions: [blockAdvertPublisherQueue, blockIndexWriterQueue],
      environment: {
        BLOCK_ADVERT_PUBLISHER_QUEUE_URL: blockAdvertPublisherQueue.queueUrl,
        BLOCK_INDEX_WRITER_QUEUE_URL: blockIndexWriterQueue.queueUrl,
      },
    }
  }
  const { egressTrafficQueue } = use(BillingStack)

  // Setup API
  const customDomains = process.env.HOSTED_ZONES?.split(',').map((zone) =>
    getCustomDomain(stack.stage, zone)
  )
  const pkg = getApiPackageJson()
  const git = getGitInfo()
  const ucanInvocationPostbasicAuth = new Config.Secret(
    stack,
    'UCAN_INVOCATION_POST_BASIC_AUTH'
  )

  const apis = (customDomains ?? [undefined]).map((customDomain, idx) => {
    const hostedZone = customDomain?.hostedZone
    // the first customDomain will be web3.storage, and we don't want the apiId for that domain to have a second part, see PR of this change for context
    const apiId = [
      `http-gateway`,
      idx > 0 ? hostedZone?.replaceAll('.', '_') : '',
    ]
      .filter(Boolean)
      .join('-')
    return new Api(stack, apiId, {
      customDomain,
      defaults: {
        function: {
          timeout: '60 seconds',
          environment: {
            NAME: pkg.name,
            VERSION: pkg.version,
            COMMIT: git.commmit,
            STAGE: stack.stage,
            OTEL_EXPORTER_OTLP_ENDPOINT:
              process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? '',
            OTEL_TRACES_SAMPLER: process.env.OTEL_TRACES_SAMPLER ?? '',
            OTEL_TRACES_SAMPLER_ARG: process.env.OTEL_TRACES_SAMPLER_ARG ?? '',
          },
        },
      },
      routes: {
        'POST /': {
          function: {
            handler: 'upload-api/functions/ucan-invocation-router.handler',
            permissions: [
              adminMetricsTable,
              agentIndexBucket,
              agentIndexTable,
              agentMessageBucket,
              allocationTable, // legacy
              blobRegistryTable,
              carparkBucket,
              consumerTable,
              customerTable,
              delegationBucket,
              delegationTable,
              egressTrafficQueue,
              egressTrafficTable,
              filecoinSubmitQueue,
              ...(ipniConfig ? ipniConfig.permissions : []),
              pieceOfferQueue,
              pieceTable,
              rateLimitTable,
              replicaTable,
              revocationTable,
              spaceDiffTable,
              spaceMetricsTable,
              spaceSnapshotTable,
              storeTable, // legacy
              storageProviderTable,
              subscriptionTable,
              ucanStream,
              uploadTable,
              // SSM permissions for loading config at runtime (avoids 4KB env var limit)
              new iam.PolicyStatement({
                actions: ['ssm:GetParameters'],
                resources: ssmParameterArns,
              }),
              uploadShardsBucket,
            ],
            environment: {
              ADMIN_METRICS_TABLE: adminMetricsTable.tableName,
              AGENT_INDEX_BUCKET: agentIndexBucket.bucketName,
              AGENT_INDEX_TABLE: agentIndexTable.tableName,
              AGENT_MESSAGE_BUCKET: agentMessageBucket.bucketName,
              AGGREGATOR_DID,
              ALLOCATION_TABLE: allocationTable.tableName,
              BLOB_REGISTRY_TABLE: blobRegistryTable.tableName,
              CONSUMER_TABLE: consumerTable.tableName,
              CUSTOMER_TABLE: customerTable.tableName,
              DELEGATION_BUCKET: delegationBucket.bucketName,
              DELEGATION_TABLE: delegationTable.tableName,
              DISABLE_IPNI_PUBLISHING,
              ENABLE_CUSTOMER_TRIAL_PLAN:
                process.env.ENABLE_CUSTOMER_TRIAL_PLAN ?? 'false',
              EGRESS_TRAFFIC_QUEUE: egressTrafficQueue.queueUrl,
              EGRESS_TRAFFIC_TABLE: egressTrafficTable.tableName,
              FILECOIN_SUBMIT_QUEUE: filecoinSubmitQueue.queueUrl,
              ...(ipniConfig ? ipniConfig.environment : {}),
              PIECE_OFFER_QUEUE: pieceOfferQueue.queueUrl,
              PIECE_TABLE: pieceTable.tableName,
              RATE_LIMIT_TABLE: rateLimitTable.tableName,
              REPLICA_TABLE: replicaTable.tableName,
              REVOCATION_TABLE: revocationTable.tableName,
              SPACE_DIFF_TABLE: spaceDiffTable.tableName,
              SPACE_METRICS_TABLE: spaceMetricsTable.tableName,
              SPACE_SNAPSHOT_TABLE: spaceSnapshotTable.tableName,
              STORAGE_PROVIDER_TABLE: storageProviderTable.tableName,
              STORE_BUCKET: carparkBucket.bucketName,
              STORE_TABLE: storeTable.tableName,
              SUBSCRIPTION_TABLE: subscriptionTable.tableName,
              UCAN_LOGS: ucanStream.streamName,
              UPLOAD_SERVICE_URL: getServiceURL(stack, customDomain) ?? '',
              UPLOAD_TABLE: uploadTable.tableName,
              UPLOAD_SHARDS_BUCKET: uploadShardsBucket.bucketName,
            },
            bind: [
              contentClaimsPrivateKey,
              indexingServiceProof,
              ...(process.env.FILECOIN_PROOFS_NOT_REQUIRED === 'true'
                ? []
                : [aggregatorServiceProof, dealTrackerServiceProof]),
              privateKey,
              stripeSecretKey,
              dmailApiKey,
              dmailApiSecret,
              dmailJwtSecret,
            ],
          },
        },
        'POST /ucan': {
          function: {
            handler: 'upload-api/functions/ucan.handler',
            permissions: [agentIndexBucket, agentIndexTable, agentMessageBucket, ucanStream],
            environment: {
              AGENT_INDEX_BUCKET_NAME: agentIndexBucket.bucketName,
              AGENT_INDEX_TABLE_NAME: agentIndexTable.tableName,
              AGENT_MESSAGE_BUCKET_NAME: agentMessageBucket.bucketName,
              UCAN_LOG_STREAM_NAME: ucanStream.streamName,
            },
            bind: [ucanInvocationPostbasicAuth],
          },
        },
        'POST /bridge': {
          function: {
            handler: 'upload-api/functions/bridge.handler',
            environment: {
              ACCESS_SERVICE_URL: getServiceURL(stack, customDomain) ?? '',
              UPLOAD_API_DID: process.env.UPLOAD_API_DID ?? '',
            },
          },
        },
        'GET /': {
          function: {
            handler: 'upload-api/functions/get.home',
            environment: {
              UPLOAD_API_DID: process.env.UPLOAD_API_DID ?? '',
            },
            bind: [privateKey],
          },
        },
        'GET /validate-email': {
          function: {
            handler: 'upload-api/functions/validate-email.preValidateEmail',
            environment: {
              HOSTED_ZONE: hostedZone ?? '',
            },
          },
        },
        'POST /validate-email': {
          function: {
            handler: 'upload-api/functions/validate-email.validateEmail',
            permissions: [
              agentIndexBucket,
              agentIndexTable,
              agentMessageBucket,
              consumerTable,
              customerTable,
              delegationTable,
              delegationBucket,
              egressTrafficQueue,
              egressTrafficTable,
              rateLimitTable,
              revocationTable,
              spaceMetricsTable,
              spaceDiffTable,
              spaceSnapshotTable,
              subscriptionTable,
              ucanStream,
              // SSM permissions for loading config at runtime (avoids 4KB env var limit)
              new iam.PolicyStatement({
                actions: ['ssm:GetParameters'],
                resources: ssmParameterArns,
              }),
            ],
            environment: {
              ACCESS_SERVICE_URL: getServiceURL(stack, customDomain) ?? '',
              AGENT_INDEX_BUCKET_NAME: agentIndexBucket.bucketName,
              AGENT_INDEX_TABLE_NAME: agentIndexTable.tableName,
              AGENT_MESSAGE_BUCKET_NAME: agentMessageBucket.bucketName,
              CONSUMER_TABLE_NAME: consumerTable.tableName,
              CUSTOMER_TABLE_NAME: customerTable.tableName,
              DELEGATION_TABLE_NAME: delegationTable.tableName,
              DELEGATION_BUCKET_NAME: delegationBucket.bucketName,
              EGRESS_TRAFFIC_QUEUE_URL: egressTrafficQueue.queueUrl,
              HOSTED_ZONE: hostedZone ?? '',
              RATE_LIMIT_TABLE_NAME: rateLimitTable.tableName,
              REFERRALS_ENDPOINT: process.env.REFERRALS_ENDPOINT ?? '',
              REVOCATION_TABLE_NAME: revocationTable.tableName,
              SPACE_DIFF_TABLE_NAME: spaceDiffTable.tableName,
              SPACE_METRICS_TABLE_NAME: spaceMetricsTable.tableName,
              SPACE_SNAPSHOT_TABLE_NAME: spaceSnapshotTable.tableName,
              SUBSCRIPTION_TABLE_NAME: subscriptionTable.tableName,
              UCAN_LOG_STREAM_NAME: ucanStream.streamName,
              EGRESS_TRAFFIC_TABLE_NAME: egressTrafficTable.tableName,
            },
            bind: [privateKey],
          },
        },
        'GET /error': 'upload-api/functions/get.error',
        'GET /version': {
          function: {
            handler: 'upload-api/functions/get.version',
            environment: {
              UPLOAD_API_DID: process.env.UPLOAD_API_DID ?? '',
            },
            bind: [privateKey],
          },
        },
        'GET /.well-known/did.json': {
          function: {
            handler: 'upload-api/functions/get.didDocument',
            environment: {
              UPLOAD_API_DID: process.env.UPLOAD_API_DID ?? '',
              UPLOAD_API_ALIAS: process.env.UPLOAD_API_ALIAS ?? '',
              UPLOAD_API_DEPRECATED_DIDS:
                process.env.UPLOAD_API_DEPRECATED_DIDS ?? '',
            },
            bind: [privateKey],
          },
        },
        'GET /receipt/{taskCid}': {
          function: {
            handler: 'upload-api/functions/receipt.handler',
            permissions: [agentIndexBucket, agentIndexTable, agentMessageBucket],
            environment: {
              AGENT_INDEX_BUCKET_NAME: agentIndexBucket.bucketName,
              AGENT_INDEX_TABLE_NAME: agentIndexTable.tableName,
              AGENT_MESSAGE_BUCKET_NAME: agentMessageBucket.bucketName,
            },
          },
        },
        'GET /storefront-cron': {
          function: {
            handler: 'upload-api/functions/storefront-cron.handler',
            permissions: [agentIndexBucket, agentIndexTable, agentMessageBucket, pieceTable],
            environment: {
              AGENT_INDEX_BUCKET_NAME: agentIndexBucket.bucketName,
              AGENT_INDEX_TABLE_NAME: agentIndexTable.tableName,
              AGENT_MESSAGE_BUCKET_NAME: agentMessageBucket.bucketName,
              AGGREGATOR_DID,
              DID: process.env.UPLOAD_API_DID ?? '',
              PIECE_TABLE_NAME: pieceTable.tableName,
            },
            bind: [privateKey],
          },
        },
        'GET /metrics': {
          function: {
            handler: 'upload-api/functions/metrics.handler',
            permissions: [adminMetricsTable],
            environment: {
              ADMIN_METRICS_TABLE_NAME: adminMetricsTable.tableName,
            },
          },
        },
        // AWS API Gateway does not know trailing slash... and Grafana Agent puts trailing slash
        'GET /metrics/{proxy+}': {
          function: {
            handler: 'upload-api/functions/metrics.handler',
            permissions: [adminMetricsTable],
            environment: {
              ADMIN_METRICS_TABLE_NAME: adminMetricsTable.tableName,
            },
          },
        },
        'GET /sample': {
          function: {
            handler: 'upload-api/functions/sample.handler',
            permissions: [uploadTable],
            environment: {
              UPLOAD_TABLE_NAME: uploadTable.tableName,
            },
          },
        },
        'GET /revocations/{cid}': {
          function: {
            handler: 'upload-api/functions/revocations-check.handler',
            permissions: [revocationTable],
            environment: {
              REVOCATION_TABLE_NAME: revocationTable.tableName,
              DELEGATION_BUCKET_NAME: delegationBucket.bucketName,
            },
          },
        },
        'GET /oauth/callback': {
          function: {
            handler: 'upload-api/functions/oauth-callback.handler',
            permissions: [
              agentIndexBucket,
              agentIndexTable,
              agentMessageBucket,
              customerTable,
              ucanStream,
            ],
            environment: {
              AGENT_INDEX_BUCKET_NAME: agentIndexBucket.bucketName,
              AGENT_INDEX_TABLE_NAME: agentIndexTable.tableName,
              AGENT_MESSAGE_BUCKET_NAME: agentMessageBucket.bucketName,
              CUSTOMER_TABLE_NAME: customerTable.tableName,
              GITHUB_CLIENT_ID: process.env.GITHUB_CLIENT_ID ?? '',
              UCAN_LOG_STREAM_NAME: ucanStream.streamName,
              UPLOAD_API_DID: process.env.UPLOAD_API_DID ?? '',
              UPLOAD_SERVICE_URL: getServiceURL(stack, customDomain) ?? '',
            },
            bind: [githubClientSecret, privateKey],
          },
        },
        'GET /oauth/humanode/callback': {
          function: {
            handler: 'upload-api/functions/oauth-humanode-callback.handler',
            permissions: [customerTable, humanodeTable],
            environment: {
              CUSTOMER_TABLE_NAME: customerTable.tableName,
              HUMANODE_CLIENT_ID: process.env.HUMANODE_CLIENT_ID ?? '',
              HUMANODE_TABLE_NAME: humanodeTable.tableName,
              HUMANODE_TOKEN_ENDPOINT:
                process.env.HUMANODE_TOKEN_ENDPOINT ?? '',
              UPLOAD_API_DID: process.env.UPLOAD_API_DID ?? '',
            },
            bind: [humanodeClientSecret, privateKey],
          },
        },
      },
      accessLog: {
        format:
          '{"requestTime":"$context.requestTime","requestId":"$context.requestId","httpMethod":"$context.httpMethod","path":"$context.path","routeKey":"$context.routeKey","status":$context.status,"responseLatency":$context.responseLatency,"integrationRequestId":"$context.integration.requestId","integrationStatus":"$context.integration.status","integrationLatency":"$context.integration.latency","integrationServiceStatus":"$context.integration.integrationStatus","ip":"$context.identity.sourceIp","userAgent":"$context.identity.userAgent"}',
      },
      cors: {
        allowHeaders: ['*'],
        allowMethods: ['ANY'],
        allowOrigins: ['*'],
        maxAge: '1 day',
      },
    })
  })

  // UCAN stream metrics for admin and space
  const uploadAdminMetricsDLQ = new Queue(stack, 'upload-admin-metrics-dlq')
  const uploadAdminMetricsConsumer = new Function(
    stack,
    'upload-admin-metrics-consumer',
    {
      environment: {
        ADMIN_METRICS_TABLE_NAME: adminMetricsTable.tableName,
        STORE_BUCKET_NAME: carparkBucket.bucketName,
        ALLOCATION_TABLE_NAME: allocationTable.tableName,
      },
      permissions: [adminMetricsTable, carparkBucket, allocationTable],
      handler: 'upload-api/functions/admin-metrics.consumer',
      deadLetterQueue: uploadAdminMetricsDLQ.cdk.queue,
    }
  )

  const uploadSpaceMetricsDLQ = new Queue(stack, 'upload-space-metrics-dlq')
  const uploadSpaceMetricsConsumer = new Function(
    stack,
    'upload-space-metrics-consumer',
    {
      environment: {
        SPACE_METRICS_TABLE_NAME: spaceMetricsTable.tableName,
        STORE_BUCKET_NAME: carparkBucket.bucketName,
        ALLOCATION_TABLE_NAME: allocationTable.tableName,
      },
      permissions: [spaceMetricsTable, carparkBucket, allocationTable],
      handler: 'upload-api/functions/space-metrics.consumer',
      deadLetterQueue: uploadSpaceMetricsDLQ.cdk.queue,
    }
  )

  ucanStream.addConsumers(stack, {
    uploadAdminMetricsConsumer: {
      function: uploadAdminMetricsConsumer,
      cdk: {
        eventSource: {
          ...getEventSourceConfig(stack),
          batchSize: 25,
          // Override where to begin consuming the stream to latest as we already are reading from this stream
          startingPosition: StartingPosition.LATEST,
          filters: [
            FilterCriteria.filter({
              data: {
                type: FilterRule.isEqual('receipt'),
              },
            }),
          ],
        },
      },
    },
    uploadSpaceMetricsConsumer: {
      function: uploadSpaceMetricsConsumer,
      cdk: {
        eventSource: {
          ...getEventSourceConfig(stack),
          batchSize: 25,
          // Override where to begin consuming the stream to latest as we already are reading from this stream
          startingPosition: StartingPosition.LATEST,
          filters: [
            FilterCriteria.filter({
              data: {
                type: FilterRule.isEqual('receipt'),
              },
            }),
          ],
        },
      },
    },
  })

  stack.addOutputs({
    ApiEndpoints: JSON.stringify(apis.map((api) => api.url)),
    CustomDomains: customDomains
      ? JSON.stringify(
          customDomains.map(
            (customDomain) => `https://${customDomain?.domainName}`
          )
        )
      : 'Set HOSTED_ZONES in env to deploy to a custom domain',
  })
}
