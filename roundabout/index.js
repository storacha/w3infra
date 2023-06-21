import { getSignedUrl as getR2SignedUrl } from "@aws-sdk/s3-request-presigner"
import {
  GetObjectCommand,
  HeadObjectCommand
} from "@aws-sdk/client-s3"

/**
 * @typedef {import('@aws-sdk/client-s3').S3Client} S3Client
 * @typedef {import('@aws-sdk/types').RequestPresigningArguments} RequestPresigningArguments
 */

/**
 * @param {S3Client} s3Client
 * @param {string} bucketName 
 */
export function getSigner (s3Client, bucketName) {
  return {
    /**
     * 
     * @param {import('multiformats').CID} cid
     * @param {RequestPresigningArguments} [options]
     */
    getUrl: async (cid, options) => {
      const key = `${cid}/${cid}.car`

      // Validate bucket has requested cid
      const headCommand = new HeadObjectCommand({
        Bucket: bucketName,
        Key: key,
      })
      try {
        await s3Client.send(headCommand)
      } catch (err) {
        if (err?.$metadata?.httpStatusCode === 404) {
          return
        }
        throw new Error(`Failed to HEAD object in bucket for: ${key}`)
      }

      const signedUrl = await getR2SignedUrl(
        s3Client,
        new GetObjectCommand({
          Bucket: bucketName,
          Key: key
        }),
        options
      )

      return signedUrl
    }
  }
}
