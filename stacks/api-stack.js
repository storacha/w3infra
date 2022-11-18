import {
  Api,
  Bucket,
  Table
} from '@serverless-stack/resources'

import { getConfig } from './config.js'

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

  const api = new Api(stack, 'http-gateway', {
    defaults: {
      function: {
        permissions: [storeTable, uploadTable, storeBucket],
        environment: {
          STORE_TABLE_NAME: storeTable.tableName,
          STORE_BUCKET_NAME: storeBucket.bucketName,
          UPLOAD_TABLE_NAME: uploadTable.tableName
        }
      }
    },
    routes: {
      'POST /': 'functions/ucan-invocation-router.handler',
    },
  })

  stack.addOutputs({
    ApiEndpoint: api.url,
  })
}
