import {
  S3Client,
  PutObjectCommand,
} from '@aws-sdk/client-s3'
import pRetry from 'p-retry'
import { getS3Client } from '../../lib/aws/s3.js'

/**
 * Abstraction layer with Factory to perform operations on bucket storing
 * handled Tasks and their indexes.
 *
 * @param {string} region
 * @param {string} bucketName
 * @param {import('@aws-sdk/client-s3').ServiceInputTypes} [options]
 */
export function createTaskStore(region, bucketName, options = {}) {
  const s3client = getS3Client({
    region,
    ...options,
  })
  return useTaskStore(s3client, bucketName)
}

/**
 * @param {S3Client} s3client
 * @param {string} bucketName
 * @returns {import('../types').TaskBucket}
 */
export const useTaskStore = (s3client, bucketName) => {
  return {
    /**
     * Put block containing `out` field of the receipt, so that when we get an invocation
     * with the same task we can read the result and issue receipt without rerunning
     * a task. Could be written on first receipt.
     *
     * @param {string} taskCid
     * @param {Uint8Array} bytes
     */
    putResult: async (taskCid, bytes) => {
      const putCmd = new PutObjectCommand({
        Bucket: bucketName,
        Key: `${taskCid}/${taskCid}.result`,
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
    putInvocationLink: async (taskCid, invocationCid) => {
      const putCmd = new PutObjectCommand({
        Bucket: bucketName,
        Key: `${taskCid}/${invocationCid}.invocation`,
      })
      await pRetry(() => s3client.send(putCmd))
    },
  }
}
