import { parseLink } from '@ucanto/core'
import * as Store from '../../upload-api/stores/agent/store.js'
import { getS3Client } from '../../lib/aws/s3.js'
import { getDynamoClient } from '../../lib/aws/dynamo.js'

/**
 * Abstraction layer with Factory to perform operations on bucket storing
 * invocation receipts and indexes.
 *
 * @param {string} region
 * @param {string} tableName
 * @param {{
 *   s3Address?: Partial<import('../../lib/aws/s3.js').Address>
 *   dynamoAddress?: Partial<import('../../lib/aws/dynamo.js').Address>
 * }} [options]
 */
export function createInvocationStore(region, tableName, options = {}) {
  const dynamoDBClient = getDynamoClient({
    region,
    ...options.dynamoAddress,
  })
  const s3client = getS3Client({
    region,
    ...options.s3Address,
  })

  return useInvocationStore(dynamoDBClient, s3client, tableName)
}

/**
 * @param {import('@aws-sdk/client-dynamodb').DynamoDBClient} dynamoDBClient
 * @param {import('@aws-sdk/client-s3').S3Client} s3client
 * @param {string} tableName
 * @returns {import('../types.js').InvocationTable}
 */
export const useInvocationStore = (dynamoDBClient, s3client, tableName) => {
  const store = Store.open({
    s3Connection: { channel: s3client },
    dynamoDBConnection: { channel: dynamoDBClient },
    region:
      typeof s3client.config.region === 'string'
        ? s3client.config.region
        : 'us-west-2',
    buckets: {
      message: { name: '' },
    },
    tables: {
      index: { name: tableName },
    },
  })

  return {
    /**
     * Get the agent message file CID for an invocation.
     *
     * @param {string} invocationCid
     */
    getInLink: async (invocationCid) => {
      const result = await Store.resolve(store, {
        invocation: parseLink(invocationCid),
      })
      if (result.ok) {
        return result.ok.message.toString()
      }
    },
  }
}
