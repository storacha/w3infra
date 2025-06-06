import { getSignedUrl as getR2SignedUrl } from '@aws-sdk/s3-request-presigner'
import { GetObjectCommand } from '@aws-sdk/client-s3'
/**
 * @import { UnknownLink } from 'multiformats'
 * @import { IndexingServiceClient } from '@storacha/indexing-service-client/api'
 * @import { S3Client } from '@aws-sdk/client-s3'
 * @import { RequestPresigningArguments } from '@smithy/types'
 */
import { RAW_CODE, CARPARK_DOMAIN } from './constants.js'

/**
 * @param {S3Client} s3Client
 * @param {string} bucketName 
 */
export function getSigner (s3Client, bucketName) {
  return {
    /**
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
 * @param {IndexingServiceClient} config.indexingService
 */
export function contentLocationResolver ({ s3Client, bucket, expiresIn, indexingService }) {
  const signer = getSigner(s3Client, bucket)
  /**
   * @param {UnknownLink} cid
   */
  return async function locateContent (cid) {
    if (cid.code !== RAW_CODE) {
      const carKey = `${cid}/${cid}.car`
      return signer.getUrl(carKey, { expiresIn })
    }

    const res = await indexingService.queryClaims({ hashes: [cid.multihash] })
    if (res.error) {
      console.error(res.error)
      throw new Error('indexing service query failed', { cause: res.error })
    }

    const locations = []
    for (const [, c] of res.ok.claims) {
      if (c.type === 'assert/location') {
        locations.push(...c.location)
        for (const url of c.location) {
          // if location is a known carpark URI then return a signed URL
          if (url.includes(CARPARK_DOMAIN)) {
            const blobKey = new URL(url).pathname.slice(1)
            return signer.getUrl(blobKey, { expiresIn })
          }
        }
      }
    }
    // just return a random one
    return locations[Math.floor(Math.random() * locations.length)]
  }
}
