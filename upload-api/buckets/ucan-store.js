import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3'
import pRetry from 'p-retry'

/**
 * Abstraction layer with Factory to perform operations on bucket storing
 * handled UCANs
 *
 * @param {string} region
 * @param {string} bucketName
 * @param {import('@aws-sdk/client-s3').ServiceInputTypes} [options]
 */
export function createUcanStore(region, bucketName, options = {}) {
  const s3client = new S3Client({
    region,
    ...options,
  })
  return useUcanStore(s3client, bucketName)
}

/**
 * @param {S3Client} s3client
 * @param {string} bucketName
 * @returns {import('../types').UcanBucket}
 */
export const useUcanStore = (s3client, bucketName) => {
  return {
    /**
     * Put Workflow file with UCAN invocations into bucket.
     *
     * @param {string} cid
     * @param {Uint8Array} bytes
     */
    putWorkflow: async (cid, bytes) => {
      const putCmd = new PutObjectCommand({
        Bucket: bucketName,
        // TODO: for bucket rate limit, shouldn't we do double CID?
        Key: `workflow/${cid}`,
        Body: bytes,
      })
      await pRetry(() => s3client.send(putCmd))
    },
    /**
     * Put mapping for where each invocation lives in a Workflow file.
     *
     * @param {string} invocationCid
     * @param {string} workflowCid
     */
    putInvocationIndex: async (invocationCid, workflowCid) => {
      const putCmd = new PutObjectCommand({
        Bucket: bucketName,
        Key: `invocation/${invocationCid}/${workflowCid}.workflow`,
      })
      await pRetry(() => s3client.send(putCmd))
    },
    /**
     * Put block with receipt for a given invocation.
     *
     * @param {string} invocationCid
     * @param {Uint8Array} bytes
     */
    putInvocationReceipt: async (invocationCid, bytes) => {
      const putCmd = new PutObjectCommand({
        Bucket: bucketName,
        Key: `invocation/${invocationCid}.receipt`,
        Body: bytes,
      })
      await pRetry(() => s3client.send(putCmd))
    },
    /**
     * Put block containing `out` filed of the receipt. So that when we get an invocation
     * with the same task we can read the result and issue receipt without rerunning
     * a task. Could be written on first receipt.
     *
     * @param {string} taskCid
     * @param {Uint8Array} bytes
     */
    putTaskResult: async (taskCid, bytes) => {
      const putCmd = new PutObjectCommand({
        Bucket: bucketName,
        Key: `task/${taskCid}.result`,
        Body: bytes,
      })
      await pRetry(() => s3client.send(putCmd))
    },
    /**
     * Put mapping for where each task lives in an invocation file.
     * Enables lookup invocations & receipts by task.
     *
     * @param {string} taskCid 
     * @param {string} invocationCid 
     */
    putTaskIndex: async (taskCid, invocationCid) => {
      const putCmd = new PutObjectCommand({
        Bucket: bucketName,
        Key: `task/${taskCid}/${invocationCid}.invocation`,
      })
      await pRetry(() => s3client.send(putCmd))
    },
    /**
     * Get CAR bytes for a given invocation.
     *
     * @param {string} invocationCid 
     */
    getWorkflowBytesForInvocation: async (invocationCid) => {
      const prefix = `invocation/${invocationCid}/`
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
      const carCid = carEntry.Key?.replace(prefix, '').replace('.workflow', '')
      const getObjectCmd = new GetObjectCommand({
        Bucket: bucketName,
        Key: `workflow/${carCid}`,
      })
      const s3Object = await s3client.send(getObjectCmd)
      const bytes = await s3Object.Body?.transformToByteArray()
      if (!bytes) {
        return
      }

      return bytes
    }
  }
}
