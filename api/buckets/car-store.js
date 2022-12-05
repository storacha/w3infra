import { S3Client, HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import { base64pad } from 'multiformats/bases/base64'
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"

/**
 * Abstraction layer with Factory to perform operations on bucket storing CAR files.
 *
 * @param {string} region
 * @param {string} bucketName
 * @param {import('@aws-sdk/client-s3').ServiceInputTypes} [options]
 * @returns {import('../service/types').CarStoreBucket}
 */
export function createCarStore (region, bucketName, options) {
  const s3 = new S3Client({ 
    region,
    ...options
  })

  return {
    /**
     * @param {import('../service/types').AnyLink} link
     */
    has: async (link) => {
      const cmd = new HeadObjectCommand({
        Key: `${link}/${link}.car`,
        Bucket: bucketName,
      }) 
      try {
        await s3.send(cmd)
      } catch (cause) { // @ts-expect-error
        if (cause?.$metadata?.httpStatusCode === 404) {
          return false
        }
        throw new Error('Failed to check if car-store', { cause })
      }
      return true
    },

    /**
     * Create a presigned s3 url allowing the recipient to upload
     * only the CAR that matches the provided Link
     * 
     * @param {import('../service/types').AnyLink} link
     * @param {number} size
     */
    createUploadUrl: async (link, size) => {
      const checksum = base64pad.baseEncode(link.multihash.digest)
      const cmd = new PutObjectCommand({
        Key: `${link}/${link}.car`,
        Bucket: bucketName,
        ChecksumSHA256: checksum,
        ContentLength: size
      })
      const expiresIn = 60 * 60 * 24 // 1 day
      const url = new URL(await getSignedUrl(s3, cmd, { expiresIn,  }))
      return {
        url,
        headers: {
          'x-amz-checksum-sha256': checksum,
        },
      }
    }
  }
}
