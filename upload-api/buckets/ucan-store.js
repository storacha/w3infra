import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3'

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
     * Put CAR file with UCAN invocations into bucket.
     *
     * @param {string} carCid
     * @param {Uint8Array} bytes
     */
    putCar: async (carCid, bytes) => {
      const putCmd = new PutObjectCommand({
        Bucket: bucketName,
        Key: `${carCid}/${carCid}.car`,
        Body: bytes,
      })
      await s3client.send(putCmd)
    },
    /**
     * Put mapping for where each invocation lives in a CAR file.
     *
     * @param {string} invocationCid
     * @param {string} carCid
     */
    putInvocation: async (invocationCid, carCid) => {
      const putCmd = new PutObjectCommand({
        Bucket: bucketName,
        Key: `${invocationCid}/${carCid}.invocation`,
      })
      await s3client.send(putCmd)
    },
    /**
     * Put block with receipt for a given invocation.
     *
     * @param {string} invocationCid
     * @param {string} receiptCid
     * @param {Uint8Array} bytes
     */
    putReceipt: async (invocationCid, receiptCid, bytes) => {
      const putCmd = new PutObjectCommand({
        Bucket: bucketName,
        Key: `${invocationCid}/${receiptCid}.receipt`,
        Body: bytes,
      })
      await s3client.send(putCmd)
    },
    /**
     * Get CAR bytes for a given invocation.
     *
     * @param {string} invocationCid 
     */
    getCarBytesForInvocation: async (invocationCid) => {
      const listObjectCmd = new ListObjectsV2Command({
        Bucket: bucketName,
        Prefix: `${invocationCid}/`,
      })
      const listObject = await s3client.send(listObjectCmd)
      const carEntry = listObject.Contents?.find(
        content => content.Key?.endsWith('.invocation')
      )
      if (!carEntry) {
        return
      }
      const carCid = carEntry.Key?.replace(`${invocationCid}/`, '').replace('.invocation', '')
      const getObjectCmd = new GetObjectCommand({
        Bucket: bucketName,
        Key: `${carCid}/${carCid}.car`,
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
