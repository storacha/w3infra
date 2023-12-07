import {
  S3Client,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3'

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
     * Get the agent message file CID for an invocation.
     *
     * @param {string} invocationCid 
     */
    getInLink: async (invocationCid) => {
      const prefix = `${invocationCid}/`
      // Multiple entries may match the key prefix. Picking an arbitrary one is fine given
      //  can receive same invocations in multiple CAR files.
      const listObjectCmd = new ListObjectsV2Command({
        Bucket: bucketName,
        Prefix: prefix,
      })
      const listObject = await s3client.send(listObjectCmd)
      const carEntry = listObject.Contents?.find(
        content => content.Key?.endsWith('.in')
      )
      if (!carEntry) {
        return
      }
      return carEntry.Key?.replace(prefix, '').replace('.in', '')
    },
  }
}
