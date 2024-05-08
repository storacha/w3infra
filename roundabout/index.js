import { getSignedUrl as getR2SignedUrl } from '@aws-sdk/s3-request-presigner'
import { GetObjectCommand } from '@aws-sdk/client-s3'
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
 * `carCid/carCid.car`.
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
      return signer.getUrl(blobKey, { expiresIn })
    }
    return signer.getUrl(carKey, { expiresIn })
  }
}
