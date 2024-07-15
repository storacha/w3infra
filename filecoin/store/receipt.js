import { StoreOperationFailed } from '@web3-storage/filecoin-api/errors'
import * as Store from '../../upload-api/stores/agent/store.js'
import { getS3Client } from '../../lib/aws/s3.js'

/**
 * Abstraction layer with Factory to perform operations on bucket storing
 * handled receipts.
 *
 * @param {string} region
 * @param {string} invocationBucketName
 * @param {string} workflowBucketName
 * @param {import('@aws-sdk/client-s3').ServiceInputTypes} [options]
 */
export function createReceiptStore(region, invocationBucketName, workflowBucketName, options = {}) {
  const s3client = getS3Client({
    region,
    ...options,
  })
  return useReceiptStore(s3client, invocationBucketName, workflowBucketName)
}

/**
 * @param {import('@aws-sdk/client-s3').S3Client} s3client
 * @param {string} invocationBucketName
 * @param {string} workflowBucketName
 * @returns {import('@web3-storage/filecoin-api/storefront/api').ReceiptStore}
 */
export const useReceiptStore = (s3client, invocationBucketName, workflowBucketName) => {
  const store = Store.open({
    connection: { channel: s3client },
    region: typeof s3client.config.region === 'string' ? s3client.config.region : 'us-west-2',
    buckets: {
      index: { name: invocationBucketName },
      message: { name: workflowBucketName },
    }
  })
  
  return {
    put: async (record) => {
      return {
        error: new StoreOperationFailed('no new receipt should be put by storefront')
      }
    },
    /**
     * @param {import('@ucanto/interface').UnknownLink} taskCid
     */
    get: (taskCid) =>  
      // @ts-expect-error - need to align RecordNotFoundError
      Store.getReceipt(store, taskCid),
    has: async (record) => {
      return {
        error: new StoreOperationFailed('no receipt should checked by storefront')
      }
    }
  }
}
