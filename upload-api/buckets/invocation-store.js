import {
  S3Client,
  PutObjectCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3'
import pRetry from 'p-retry'

/**
 * Abstraction layer with Factory to perform operations on bucket storing
 * invocation receipts and indexes.
 *
 * @param {string} region
 * @param {string} bucketName
 * @param {import('@aws-sdk/client-s3').ServiceInputTypes} [options]
 */
export function createInvocationStore(region, bucketName, options = {}) {
  const s3client = new S3Client({
    region,
    ...options,
  })
  return useInvocationStore(s3client, bucketName)
}

/**
 * @param {S3Client} s3client
 * @param {string} bucketName
 * @returns {import('../types').InvocationBucket}
 */
export const useInvocationStore = (s3client, bucketName) => {
  return {
    /**
     * Put mapping for where each invocation lives in a Workflow file.
     *
     * @param {string} invocationCid
     * @param {string} workflowCid
     */
    putWorkflowLink: async (invocationCid, workflowCid) => {
      const putCmd = new PutObjectCommand({
        Bucket: bucketName,
        Key: `${invocationCid}/${workflowCid}.workflow`,
      })
      await pRetry(() => s3client.send(putCmd))
    },
    /**
     * Put block with receipt for a given invocation.
     *
     * @param {string} invocationCid
     * @param {Uint8Array} bytes
     */
    putReceipt: async (invocationCid, bytes) => {
      const putCmd = new PutObjectCommand({
        Bucket: bucketName,
        Key: `${invocationCid}/${invocationCid}.receipt`,
        Body: bytes,
      })
      await pRetry(() => s3client.send(putCmd))
    },
    /**
     * Get the workflow CID for an invocation.
     *
     * @param {string} invocationCid 
     */
    getWorkflowLink: async (invocationCid) => {
      const prefix = `${invocationCid}/`
      const listObjectCmd = new ListObjectsV2Command({
        Bucket: bucketName,
        Prefix: prefix,
      })
      const listObject = await s3client.send(listObjectCmd)
      const carEntry = listObject.Contents?.find(
        content => content.Key?.endsWith('.workflow')
      )
      if (!carEntry) {
        return
      }
      return carEntry.Key?.replace(prefix, '').replace('.workflow', '')
    }
  }
}
