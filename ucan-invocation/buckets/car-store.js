import {
  S3Client,
  HeadObjectCommand,
} from '@aws-sdk/client-s3'

/**
 * Abstraction layer with Factory to perform operations on bucket storing CAR files.
 *
 * @param {string} region
 * @param {string} bucketName
 * @param {import('@aws-sdk/client-s3').ServiceInputTypes} [options]
 */
export function createCarStore(region, bucketName, options) {
  const s3 = new S3Client({
    region,
    ...options,
  })
  return useCarStore(s3, bucketName)
}

/**
 * @param {S3Client} s3
 * @param {string} bucketName
 * @returns {import('../types').CarStoreBucket}
 */
export function useCarStore(s3, bucketName) {
  return {
    /**
     * @param {import('multiformats').UnknownLink} link
     */
    getSize: async (link) => {
      const cid = link.toString()
      const cmd = new HeadObjectCommand({
        Key: `${cid}/${cid}.car`,
        Bucket: bucketName,
      })
      let res
      try {
        res = await s3.send(cmd)
      } catch (cause) {
        // @ts-expect-error
        if (cause?.$metadata?.httpStatusCode === 404) {
          return 0
        }
        throw new Error('Failed to check if car-store', { cause })
      }
      return res.ContentLength || 0
    },
  }
}
