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
  // @ts-ignore "prod" | "dev" | "staging" only allowed for stage
  const stackConfig = getConfig(stack.stage)

  /**
   * This table takes a stored CAR and makes an entry in the store table
   * to associate the uploaders DID with a payload CID.
   * You can also optionally indicate an application DID, origin and size
   */
   const storeTable = new Table(stack, 'store_table', {
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

  /**
   * This bucket is the car store used within the `store/*` invocations.
   * Force name of bucket to be "car-park-prod-0" in prod.
   */
  const ingestBucketCdkConfig =
    stack.stage === 'prod' ? { cdk: { bucket: { bucketName: 'car-park-prod-0' } } } : {}
  
  const carStore = new Bucket(stack, 'carStore', {
    ...stackConfig.bucketConfig,
    ...ingestBucketCdkConfig
  })

  const api = new Api(stack, 'http-gateway', {
    defaults: {
      function: {
        permissions: [storeTable, carStore],
        environment: {
          STORE_TABLE_NAME: storeTable.tableName,
          CAR_STORE_BUCKET_NAME: carStore.bucketName
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
