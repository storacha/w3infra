import { StoreOperationFailed } from '@storacha/filecoin-api/errors'
import * as Store from '../../upload-api/stores/agent/store.js'
import { getS3Client } from '../../lib/aws/s3.js'
import { getDynamoClient } from '../../lib/aws/dynamo.js'

/**
 * Abstraction layer with Factory to perform operations on bucket storing
 * handled receipts.
 *
 * @param {string} region
 * @param {string} agentIndexTableName
 * @param {string} agentIndexBucketName
 * @param {string} agentMessageBucketName
 * @param {{
 *   s3Address?: Partial<import('../../lib/aws/s3.js').Address>
 *   dynamoAddress?: Partial<import('../../lib/aws/dynamo.js').Address>
 * }} [options]
 */
export function createReceiptStore(region, agentIndexTableName, agentIndexBucketName, agentMessageBucketName, options = {}) {
  const dynamoDBClient = getDynamoClient({
    region,
    ...options.dynamoAddress,
  })
  const s3client = getS3Client({
    region,
    ...options.s3Address,
  })
  return useReceiptStore(dynamoDBClient, s3client, agentIndexTableName, agentIndexBucketName, agentMessageBucketName)
}

/**
 * @param {import('@aws-sdk/client-dynamodb').DynamoDBClient} dynamoDBClient
 * @param {import('@aws-sdk/client-s3').S3Client} s3client
 * @param {string} agentIndexTableName
 * @param {string} agentIndexBucketName
 * @param {string} agentMessageBucketName
 * @returns {import('@storacha/filecoin-api/storefront/api').ReceiptStore}
 */
export const useReceiptStore = (dynamoDBClient, s3client, agentIndexTableName, agentIndexBucketName, agentMessageBucketName) => {
  const store = Store.open({
    dynamoDBConnection: { channel: dynamoDBClient },
    s3Connection: { channel: s3client },
    region: typeof s3client.config.region === 'string' ? s3client.config.region : 'us-west-2',
    tables: {
      index: { name: agentIndexTableName }
    },
    buckets: {
      index: { name: agentIndexBucketName },
      message: { name: agentMessageBucketName },
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
