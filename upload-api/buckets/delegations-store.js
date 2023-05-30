import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3'
import pRetry from 'p-retry'
import { base32 } from 'multiformats/bases/base32'

/** @typedef {import('multiformats/cid').CID} CID */

/**
 * Abstraction layer with Factory to perform operations on bucket.
 *
 * @param {string} region
 * @param {string} bucketName
 * @param {import('@aws-sdk/client-s3').ServiceInputTypes} [options]
 */
export function createR2DelegationsStore(region, bucketName, options = {}) {
  const s3client = new S3Client({
    region,
    ...options,
  })
  return useDelegationsStore(s3client, bucketName)
}

/**
 * 
 * @param {string} endpoint 
 * @param {string} accessKeyId 
 * @param {string} secretAccessKey 
 * @param {string} bucketName
 */
export function useR2DelegationsStore(endpoint, accessKeyId, secretAccessKey, bucketName){
  const s3Client = new S3Client({
    region: 'auto',
    endpoint,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
  })
  return useDelegationsStore(s3Client, bucketName)
}

/**
 * @param { CID} cid
 */
function createDelegationsBucketKey (cid) {
  const key = /** @type {const} */ (
    `/delegations/${cid.toString(base32)}.car`
  )
  return key
}

/**
 * @param {S3Client} s3client
 * @param {string} bucketName
 * @returns {import('../types').DelegationsBucket}
 */
export const useDelegationsStore = (s3client, bucketName) => {
  return {
    /**
     * Put Delegation into bucket.
     *
     * @param {CID} cid
     * @param {Uint8Array} bytes
     */
    put: async (cid, bytes) => {
      const putCmd = new PutObjectCommand({
        Bucket: bucketName,
        Key: createDelegationsBucketKey(cid),
        Body: bytes,
      })
      await pRetry(() => s3client.send(putCmd))
    },
    /**
     * Get CAR bytes for a given delegation.
     *
     * @param {CID} cid 
     */
    get: async (cid) => {
      const getObjectCmd = new GetObjectCommand({
        Bucket: bucketName,
        Key: createDelegationsBucketKey(cid),
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
