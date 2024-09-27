import crypto from 'node:crypto'
import { HeadObjectCommand, GetObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import * as Link from 'multiformats/link'
import * as Digest from 'multiformats/hashes/digest'
import { sha256 } from 'multiformats/hashes/sha2'

/**
 * @typedef {import('multiformats').UnknownLink} UnknownLink
 * @typedef {{ name: string, region: string, toKey: (root: UnknownLink) => string }} Bucket
 * @typedef {{ name: string, region: string, key: string, size: number }} Location
 */

/**
 * @param {Bucket[]} buckets
 * @param {UnknownLink} root
 * @returns {Promise<Location|undefined>}
 */
export const locateCAR = async (buckets, root) => {
  for (const bucket of buckets) {
    const key = bucket.toKey(root)
    const client = new S3Client({ region: bucket.region })
    const cmd = new HeadObjectCommand({
      Bucket: bucket.name,
      Key: key
    })
    try {
      const res = await client.send(cmd)
      const size = res.ContentLength
      if (size == null) throw new Error(`missing ContentLength: ${root}`)
      return { name: bucket.name, region: bucket.region, key, size }
    } catch (err) {
      if (err?.$metadata.httpStatusCode !== 404) {
        throw err
      }
    }
  }
}

/**
 * Get the hash of a CAR file stored in one of the passed buckets that contains
 * the complete DAG for the given root CID.
 * 
 * @param {Bucket[]} buckets
 * @param {UnknownLink} root
 * @throws {NotFound}
 */
export const getHash = async (buckets, root) => {
  const bucket = await locateCAR(buckets, root)
  if (!bucket) {
    throw new NotFound(`Not found: ${root}`)
  }

  const s3 = new S3Client({ region })
  const cmd = new GetObjectCommand({ Bucket: bucket.name, Key: bucket.key })

  const res = await s3.send(cmd)
  if (!res.Body) {
    throw new NotFound(`Object not found: ${root}`)
  }

  const hash = crypto.createHash('sha256')
  await res.Body.transformToWebStream()
    .pipeTo(new WritableStream({ write: chunk => { hash.update(chunk) } }))

  const digest = Digest.create(sha256.code, hash.digest())
  return Link.create(CAR_CODEC, digest)
}

export const DownloadURLExpiration = 1000 * 60 * 60 * 24 // 1 day in seconds

/**
 * Get a signed download URL for the CAR file stored in one of the passed
 * buckets that contains the complete DAG for the given root CID.
 * 
 * @param {Bucket[]} buckets
 * @param {UnknownLink} root
 * @throws {NotFound}
 */
export const getDownloadURL = async (buckets, root) => {
  const bucket = await locateCAR(buckets, root)
  if (!bucket) {
    throw new NotFound(`Not found: ${root}`)
  }

  const s3 = new S3Client({ region: bucket.region })
  const cmd = new GetObjectCommand({ Bucket: bucket.name, Key: bucket.key })
  const url = await getSignedUrl(s3, cmd, { expiresIn: DownloadURLExpiration })
  return new URL(url)
}

export class NotFound extends Error {}
