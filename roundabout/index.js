import { getSignedUrl as getR2SignedUrl } from '@aws-sdk/s3-request-presigner'
import {
  GetObjectCommand,
  HeadObjectCommand
} from '@aws-sdk/client-s3'
import pAny from 'p-any'

import { asPieceCidV1, asPieceCidV2, asCarCid } from './piece.js'
import {
  getBucketKeyPairToRedirect,
} from './utils.js'
import { findEquivalentCarCids, findLocationsForLink } from './claims.js'

/**
 * @typedef {import('@aws-sdk/client-s3').S3Client} S3Client
 * @typedef {import('@aws-sdk/types').RequestPresigningArguments} RequestPresigningArguments
 * @typedef {import('multiformats').UnknownLink} UnknownLink
 * @typedef {import('@web3-storage/content-claims/client/api').Claim} Claim
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

/**
 * Return response for a car CID, or undefined for other CID types
 * 
 * @param {UnknownLink} cid
 * @param {(cid: UnknownLink) => Promise<string | undefined> } locateCar
 */
export async function resolveCar (cid, locateCar) {
  if (asCarCid(cid) !== undefined) {
    const url = await locateCar(cid)
    if (url) {
      return redirectTo(url)
    }
    return { statusCode: 404, body: 'CAR Not found'}
  }
}

/**
 * Creates a helper function that returns signed bucket url for a car cid, 
 * or undefined if the CAR does not exist in the bucket.
 *
 * @param {object} config
 * @param {S3Client} config.s3Client
 * @param {number} config.expiresIn
 * @param {string} config.defaultBucketName
 * @param {(link: UnknownLink) => Promise<Claim[]>} [config.fetchClaims]
 * @param {string[]} [config.validR2Buckets]
 * @param {string[]} [config.validS3Buckets]
 */
export function carLocationResolver ({ s3Client, expiresIn, fetchClaims, validR2Buckets, validS3Buckets, defaultBucketName }) {
  /**
   * @param {UnknownLink} cid
   */
  return async function locateCar (cid) {
    const locations = await findLocationsForLink(cid, fetchClaims)
    const pairs = getBucketKeyPairToRedirect(locations, {
      validR2Buckets,
      validS3Buckets
    })

    if (!pairs.length) {
      // Fallback to attempt old bucket
      const signer = getSigner(s3Client, defaultBucketName)
      const key = `${cid}/${cid}.car`
      return signer.getUrl(key, { expiresIn }) 
    }

    // Get first available response
    try {
      return await pAny(pairs.map(({ bucketName, key }) => {
        const signer = getSigner(s3Client, bucketName)
        return signer.getUrl(key, { expiresIn })  
      }), {
        filter: Boolean
      })
    } catch {
      // Return undefined if not found in any location for redirect
      return
    }
  }
}

/**
 * Return response for a Piece CID, or undefined for other CID types
 * 
 * @param {UnknownLink} cid
 * @param {(cid: UnknownLink) => Promise<string | undefined> } locateCar
 */
export async function resolvePiece (cid, locateCar) {
  if (asPieceCidV2(cid) !== undefined) {
    const cars = await findEquivalentCarCids(cid)
    if (cars.size === 0) {
      return { statusCode: 404, body: 'No equivalent CAR CID for Piece CID found' }
    }
    for (const cid of cars) {
      const url = await locateCar(cid)
      if (url) {
        return redirectTo(url)
      }
    }
    return { statusCode: 404, body: 'No CARs found for Piece CID' }
  }

  if (asPieceCidV1(cid) !== undefined) {
    return {
      statusCode: 415,
      body: 'v1 Piece CIDs are not supported yet. Please provide a V2 Piece CID. https://github.com/filecoin-project/FIPs/blob/master/FRCs/frc-0069.md'
    }
  }
}

/**
 * @param {string} url
 */
export function redirectTo (url) {
  return {
    statusCode: 302,
    headers: {
      Location: url
    }
  }
}
