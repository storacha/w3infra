import { S3Client, HeadObjectCommand } from '@aws-sdk/client-s3'

/**
 * Abstraction layer with Factory to perform operations on bucket storing CAR files.
 *
 * @param {string} region
 * @param {string} bucketName
 * @param {object} [options]
 * @param {string} [options.endpoint] - needed for testing
 */
export function create (region, bucketName, options = {}) {
  const s3client = new S3Client({
    region,
    ...options
  })

  return {
    has: async (/** @type {string} */ key) => {
      const normalizedKey = `${key}/${key}.car`
      let headObjectResponse
      try {
        headObjectResponse = await s3client.send(
          new HeadObjectCommand({
            Bucket: bucketName,
            Key: normalizedKey
          })
        )
      } catch (error) {
        console.log(`failed head command for ${normalizedKey} with: ` + error)
      }

      return headObjectResponse !== undefined
    }
  }
}
