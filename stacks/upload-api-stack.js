import {
  Api,
  Config,
  use
} from '@serverless-stack/resources'
import { UploadDbStack } from './upload-db-stack.js'
import { CarparkStack } from './carpark-stack.js'
import { UcanInvocationStack } from './ucan-invocation-stack.js'

import { getCustomDomain, getApiPackageJson, getGitInfo, setupSentry } from './config.js'

/**
 * @param {import('@serverless-stack/resources').StackContext} properties
 */
export function UploadApiStack({ stack, app }) {
  stack.setDefaultFunctionProps({
    srcPath: 'upload-api'
  })

  // Setup app monitoring with Sentry
  setupSentry(app, stack)

  // Get references to constructs created in other stacks
  const { carparkBucket } = use(CarparkStack)
  const { storeTable, uploadTable } = use(UploadDbStack)
  const { ucanBucket, ucanStream } = use(UcanInvocationStack)

  // Setup API
  const customDomain = getCustomDomain(stack.stage, process.env.HOSTED_ZONE)
  const pkg = getApiPackageJson()
  const git = getGitInfo()
  const privateKey = new Config.Secret(stack, 'PRIVATE_KEY')

  const api = new Api(stack, 'http-gateway', {
    customDomain,
    defaults: {
      function: {
        permissions: [storeTable, uploadTable, carparkBucket, ucanBucket, ucanStream],
        environment: {
          STORE_TABLE_NAME: storeTable.tableName,
          STORE_BUCKET_NAME: carparkBucket.bucketName,
          UPLOAD_TABLE_NAME: uploadTable.tableName,
          UCAN_BUCKET_NAME: ucanBucket.bucketName,
          UCAN_LOG_STREAM_NAME: ucanStream.streamName,
          NAME: pkg.name,
          VERSION: pkg.version,
          COMMIT: git.commmit,
          STAGE: stack.stage,
          ACCESS_SERVICE_DID: process.env.ACCESS_SERVICE_DID ?? '',
          ACCESS_SERVICE_URL: process.env.ACCESS_SERVICE_URL ?? '',
          R2_ACCESS_KEY_ID: process.env.R2_ACCESS_KEY_ID ?? '',
          R2_SECRET_ACCESS_KEY: process.env.R2_SECRET_ACCESS_KEY ?? '',
          R2_REGION: process.env.R2_REGION ?? '',
          R2_DUDEWHERE_BUCKET_NAME: process.env.R2_DUDEWHERE_BUCKET_NAME ?? '',
          R2_ENDPOINT: process.env.R2_ENDPOINT ?? '',
          UPLOAD_API_DID: process.env.UPLOAD_API_DID ?? '',
        },
        bind: [
          privateKey,
        ]
      }
    },
    routes: {
      'POST /':        'functions/ucan-invocation-router.handler',
       'GET /':        'functions/get.home',
       'GET /error':   'functions/get.error',
       'GET /version': 'functions/get.version'
    },
  })

  stack.addOutputs({
    ApiEndpoint: api.url,
    CustomDomain:  customDomain ? `https://${customDomain.domainName}` : 'Set HOSTED_ZONE in env to deploy to a custom domain'
  })
}
