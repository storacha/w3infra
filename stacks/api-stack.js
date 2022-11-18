import {
  Api,
  Bucket,
  Table
} from '@serverless-stack/resources'

import { getConfig, getCustomDomain, getApiPackageJson, getGitInfo } from './config.js'

/**
 * @param {import('@serverless-stack/resources').StackContext} properties
 */
export function ApiStack({ stack }) {
  // @ts-expect-error "prod" | "dev" | "staging" only allowed for stage
  const stackConfig = getConfig(stack.stage)

  /**
   * This table takes a stored CAR and makes an entry in the store table
   * to associate the uploaders DID with a payload CID.
   * You can also optionally indicate an application DID and origin.
   *
   * This is used by the store/* service capabilities.
   */
   const storeTable = new Table(stack, 'store', {
    fields: {
      uploaderDID: 'string',
      payloadCID: 'string',
      applicationDID: 'string',
      origin: 'string',
      size: 'number',
      proof: 'string',
      uploadedAt: 'string',
    },
    primaryIndex: { partitionKey: 'uploaderDID', sortKey: 'payloadCID' },
    ...stackConfig.tableConfig,
  })
  
  const storeBucket = new Bucket(stack, 'car-store', {
    ...stackConfig.bucketConfig
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
    fields: {
      uploaderDID: 'string',
      dataCID: 'string', // root CID
      carCID: 'string', // shard CID
      sk: 'string', // 'dataCID#carCID' used to guarantee uniqueness
      uploadedAt: 'string',
    },
    primaryIndex: { partitionKey: 'uploaderDID', sortKey: 'sk' },
    ...stackConfig.tableConfig,
  })

  const customDomain = getCustomDomain(stack.stage, process.env.HOSTED_ZONE)

  const pkg = getApiPackageJson()
  const git = getGitInfo()

  const api = new Api(stack, 'http-gateway', {
    customDomain,
    defaults: {
      function: {
        permissions: [storeTable, uploadTable, storeBucket],
        environment: {
          STORE_TABLE_NAME: storeTable.tableName,
          STORE_BUCKET_NAME: storeBucket.bucketName,
          UPLOAD_TABLE_NAME: uploadTable.tableName,
          NAME: pkg.name,
          VERSION: pkg.version,
          COMMIT: git.commmit,
          BRANCH: git.branch,
          STAGE: stack.stage
        }
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

