import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'

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
 * @returns {import('@web3-storage/upload-api').UcanBucket}
 */
export const useUcanStore = (s3client, bucketName) => {
  return {
    /**
     * Put UCAN invocation CAR file into bucket
     *
     * @param {string} carCid
     * @param {Uint8Array} bytes
     */
    put: async (carCid, bytes) => {
      const putCmd = new PutObjectCommand({
        Bucket: bucketName,
        Key: `${carCid}/${carCid}.car`,
        Body: bytes,
      })
      await s3client.send(putCmd)
    },
  }
}
