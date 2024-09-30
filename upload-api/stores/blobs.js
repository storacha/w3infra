import { base64pad } from 'multiformats/bases/base64'
import { base58btc } from 'multiformats/bases/base58'
import { BlobNotFound } from '@web3-storage/upload-api/blob'
import { ok, error } from '@ucanto/server'
import {
  HeadObjectCommand,
  PutObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { getS3Client } from '../../lib/aws/s3.js'

/**
 * @typedef {import('@web3-storage/upload-api/types').BlobsStorage} BlobsStorage
 * @typedef {import('@web3-storage/upload-api').BlobRetriever} BlobRetriever
 * @typedef {import('@ucanto/interface').Failure} Failure
 * @typedef {import('@ucanto/interface').Result<boolean, Failure>} HasResult
 */

/**
 * Some cloud bucket implementations like S3 have rate limits applied.
 * Rate limits happen across shards that are based on the folders structure of
 * the bucket. By relying on folder as a hash, the rate limit from bucket
 * providers can be prevented.
 *
 * @param {import('multiformats').MultihashDigest} digest
 */
const contentKey = (digest) => {
  const encodedMultihash = base58btc.encode(digest.bytes)
  return `${encodedMultihash}/${encodedMultihash}.blob`
}

/**
 * Abstraction layer with Factory to perform operations on bucket storing Blobs.
 *
 * @param {string} region
 * @param {string} bucketName
 * @param {Partial<import('../../lib/aws/s3.js').Address>} [options]
 */
export function createBlobsStorage(region, bucketName, options) {
  const s3 = getS3Client({
    region,
    ...options,
  })
  return useBlobsStorage(s3, bucketName)
}

/**
 * This is quite similar with buckets/car-store with few modifications given new key schema
 * and multihash instead of Link.
 *
 * @param {import('@aws-sdk/client-s3').S3Client} s3
 * @param {string} bucketName
 * @returns {BlobsStorage & BlobRetriever}
 */
export function useBlobsStorage(s3, bucketName) {
  return {
    /**
     * @param {import('multiformats').MultihashDigest} digest
     */
    has: async (digest) => {
      const cmd = new HeadObjectCommand({
        Key: contentKey(digest),
        Bucket: bucketName,
      })
      try {
        await s3.send(cmd)
      } catch (cause) {
        // @ts-expect-error
        if (cause?.$metadata?.httpStatusCode === 404) {
          return { ok: false }
        }
        throw new Error('Failed to check if car-store', { cause })
      }
      return { ok: true }
    },

    /** @param {import('multiformats').MultihashDigest} digest */
    async stream (digest) {
      const cmd = new GetObjectCommand({
        Key: contentKey(digest),
        Bucket: bucketName,
      })
      try {
        const res = await s3.send(cmd)
        if (!res.Body) throw new BlobNotFound(digest)
        return ok(res.Body.transformToWebStream())
      } catch (/** @type {any} */err) {
        return error(err.$metadata?.httpStatusCode === 404 ? new BlobNotFound(digest) : err)
      }
    },

    /**
     * Create a presigned s3 url allowing the recipient to upload
     * only the CAR that matches the provided Link
     *
     * @param {import('multiformats').MultihashDigest} digest
     * @param {number} size
     * @param {number} expiresIn
     */
    createUploadUrl: async (digest, size, expiresIn) => {
      const checksum = base64pad.baseEncode(digest.digest)
      const cmd = new PutObjectCommand({
        Key: contentKey(digest),
        Bucket: bucketName,
        ChecksumSHA256: checksum,
        ContentLength: size,
      })
      const url = new URL(
        await getSignedUrl(s3, cmd, {
          expiresIn,
          unhoistableHeaders: new Set(['x-amz-checksum-sha256']),
        })
      )
      return {
        ok: {
          url,
          headers: {
            'x-amz-checksum-sha256': checksum,
            'content-length': String(size),
          },
        }
      }
    },

    /** @param {import('multiformats').MultihashDigest} digest */
    createDownloadUrl: async (digest) => {
      return ok(
        /** @type {import('@ucanto/interface').URI} */
        (`https://${bucketName}.r2.w3s.link/${contentKey(digest)}`)
      )
    }
  }
}

/**
 * compose many blob stores.
 * store#createUploadUrl is from first store.
 * store#has will check stores in order until 0-1 `true` are found.
 *
 * @template {BlobsStorage} T
 * @param {T} blobStorage
 * @param {T[]} moreBlobStorages
 */
export function composeBlobStoragesWithOrderedHas(blobStorage, ...moreBlobStorages) {
  return {
    ...blobStorage,
    has: composeSome(blobStorage.has, ...moreBlobStorages.map(s => s.has.bind(s))),
  }
}

/**
 * compose async functions that return Promise<Result<boolean, Failure>>.
 * The returned function will have the same signature,
 * but will try the composed functions in order until one (or none) returns true.
 * 
 * @template T
 * @param  {Array<(e: T) => Promise<HasResult>>} hasFunctions 
 */
function composeSome(...hasFunctions) {
  /**
   * @param {T} e
   */
  return async function (e) {
    for (const has of hasFunctions) {
      const hasResult = await has(e)
      if (hasResult.ok) {
        return hasResult
      }
    }
    return { ok: false }
  }
}
