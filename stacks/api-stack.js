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
   * You can also optionally indicate an application DID, origin and size
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

  const api = new Api(stack, 'http-gateway', {
    defaults: {
      function: {
        permissions: [storeTable, storeBucket],
        environment: {
          STORE_TABLE_NAME: storeTable.tableName,
          STORE_BUCKET_NAME: storeBucket.bucketName
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
