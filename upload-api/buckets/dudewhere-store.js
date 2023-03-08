import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'

/**
 * Abstraction layer with Factory to perform operations on bucket storing
 * data CID to car CID mapping. A Bucket DB informally known as DUDEWHERE.
 *
 * @param {string} region
 * @param {string} bucketName
 * @param {import('@aws-sdk/client-s3').ServiceInputTypes} [options]
 */
export function createDudewhereStore(region, bucketName, options = {}) {
  const s3client = new S3Client({
    region,
    ...options,
  })
  return useDudewhereStore(s3client, bucketName)
}

/**
 * @param {S3Client} s3client
 * @param {string} bucketName
 * @returns {import('@web3-storage/upload-api').DudewhereBucket}
 */
export function useDudewhereStore(s3client, bucketName) {
  return {
    /**
     * Put dataCID -> carCID mapping into the bucket
     *
     * @param {string} dataCid
     * @param {string} carCid
     */
    put: async (dataCid, carCid) => {
      const putCmd = new PutObjectCommand({
        Bucket: bucketName,
        Key: `${dataCid}/${carCid}`,
        ContentLength: 0,
      })
      await s3client.send(putCmd)
    },
  }
}
