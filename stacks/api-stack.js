import {
  Api,
  Config,
  Table,
  use
} from '@serverless-stack/resources'
import {
  CarparkStack
} from './carpark-stack.js'

import { storeTableProps, uploadTableProps } from '../api/tables/index.js'
import { getConfig, getCustomDomain, getApiPackageJson, getGitInfo, setupSentry } from './config.js'

/**
 * @param {import('@serverless-stack/resources').StackContext} properties
 */
export function ApiStack({ stack, app }) {
  stack.setDefaultFunctionProps({
    srcPath: 'api'
  })

  // @ts-expect-error "prod" | "dev" | "staging" only allowed for stage
  const stackConfig = getConfig(stack.stage)

  // Setup app monitoring with Sentry
  setupSentry(app, stack)

  // Get carpark reference
  const { carparkBucket } = use(CarparkStack)

  /**
   * This table takes a stored CAR and makes an entry in the store table
   * to associate the uploaders DID with a payload CID.
   * You can also optionally indicate an application DID and origin.
   *
   * This is used by the store/* service capabilities.
   */
   const storeTable = new Table(stack, 'store', {
    ...storeTableProps,
    ...stackConfig.tableConfig,
  })

  /**
   * This table maps stored CAR files (shards) to an upload root cid (dataCID).
   * These are stored as individual rows, from dataCID to carCID:
   * 
   * upload -> {root, shards} -> maps to [[root,shard1], ...[root, shardN]]
   * 
   * This is used by the upload/* capabilities.
   */
   const uploadTable = new Table(stack, 'upload', {
    ...uploadTableProps,
    ...stackConfig.tableConfig,
  })

  const customDomain = getCustomDomain(stack.stage, process.env.HOSTED_ZONE)

  const pkg = getApiPackageJson()
  const git = getGitInfo()
  const privateKey = new Config.Secret(stack, 'PRIVATE_KEY')

  const api = new Api(stack, 'http-gateway', {
    customDomain,
    defaults: {
      function: {
        permissions: [storeTable, uploadTable, carparkBucket],
        environment: {
          STORE_TABLE_NAME: storeTable.tableName,
          STORE_BUCKET_NAME: carparkBucket.bucketName,
          UPLOAD_TABLE_NAME: uploadTable.tableName,
          NAME: pkg.name,
          VERSION: pkg.version,
          COMMIT: git.commmit,
          STAGE: stack.stage
        },
        bind: [privateKey]
      }
    },
    routes: {
      'POST /':        'functions/ucan-invocation-router.handler',
       'GET /':        'functions/get.home',
       'GET /version': 'functions/get.version'
    },
  })

  stack.addOutputs({
    ApiEndpoint: api.url,
    CustomDomain:  customDomain ? `https://${customDomain.domainName}` : 'Set HOSTED_ZONE in env to deploy to a custom domain'
  })
}
