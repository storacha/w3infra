import { getSignedUrl as getR2SignedUrl } from '@aws-sdk/s3-request-presigner'
import {
  GetObjectCommand,
  HeadObjectCommand
} from '@aws-sdk/client-s3'
import { base58btc } from 'multiformats/bases/base58'

import { RAW_CODE } from './constants.js'

/**
 * @typedef {import('multiformats').CID} CID
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
     * @param {string} key
     * @param {RequestPresigningArguments} [options]
     */
    getUrl: async (key, options) => {
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

/**
 * Creates a helper function that returns signed bucket url for content requested.
 * It currently supports both `store/*` and `blob/*` protocol written content.
 * Blobs are stored as `b58btc(multihash)/b58btc(multihash).blob` and requested to
 * Roundabout via a RAW CID.
 * Store protocol SHOULD receive CAR files that are stored as
 * `carCid/carCid.car`, but in practise there is not validation that these CIDs are
 * really a CAR CID. There is non CAR CIDs in this key format, and we MUST fallback
 * to this format if a Blob is non existent for a RAW CID.
 *
 * @param {object} config
 * @param {S3Client} config.s3Client
 * @param {string} config.bucket
 * @param {number} config.expiresIn
 */
export function contentLocationResolver ({ s3Client, bucket, expiresIn }) {
  const signer = getSigner(s3Client, bucket)
  /**
   * @param {CID} cid
   */
  return async function locateContent (cid) {
    const carKey = `${cid}/${cid}.car`

    if (cid.code === RAW_CODE) {
      const encodedMultihash = base58btc.encode(cid.multihash.bytes)
      const blobKey = `${encodedMultihash}/${encodedMultihash}.blob`
      // We MUST double check blob key actually exists before returning
      // a presigned URL for it.
      // This is required because `store/add` accepts to store data that
      // did not have a CAR CID, and was still stored as `${CID}/${CID}.car`
      const headCommand = new HeadObjectCommand({
        Bucket: bucket,
        Key: blobKey,
      })
      try {
        await s3Client.send(headCommand)
      } catch (err) {
        if (err?.$metadata?.httpStatusCode === 404) {
          // Fallback to attempt CAR CID
          return signer.getUrl(carKey, { expiresIn })
        }
        throw new Error(`Failed to HEAD object in bucket for: ${blobKey}`)
      }

      return signer.getUrl(blobKey, { expiresIn })
    }
    return signer.getUrl(carKey, { expiresIn })
  }
}
