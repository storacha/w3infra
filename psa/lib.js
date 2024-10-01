import crypto from 'node:crypto'
import { HeadObjectCommand, GetObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import * as Link from 'multiformats/link'
import * as Digest from 'multiformats/hashes/digest'
import { sha256 } from 'multiformats/hashes/sha2'

/**
 * @typedef {import('@aws-sdk/client-s3').S3Client} S3Client
 * @typedef {import('multiformats').UnknownLink} UnknownLink
 * @typedef {{ locator: Locator, hasher: Hasher }} Bucket
 * @typedef {{ root: UnknownLink, client: S3Client, bucket: string, key: string, size: number }} Location
 * @typedef {{ locate: (root: UnknownLink) => Promise<Location|undefined> }} Locator
 * @typedef {{ digest: (location: Location) => Promise<import('multiformats').Link> }} Hasher
 */

const CAR_CODEC = 0x0202

/**
 * Get the hash of a CAR file stored in one of the passed buckets that contains
 * the complete DAG for the given root CID.
 * 
 * @param {Bucket[]} buckets
 * @param {UnknownLink} root
 * @throws {NotFound}
 */
export const getHash = async (buckets, root) => {
  for (const bucket of buckets) {
    const location = await bucket.locator.locate(root)
    if (!location) continue

    const link = await bucket.hasher.digest(location)
    return { link, size: location.size }
  }
  throw new NotFound(`not found: ${root}`)
}

/**
 * Create a locator that can find a key in any S3 compatible bucket.
 *
 * @param {S3Client} client 
 * @param {string} bucketName 
 * @param {(root: UnknownLink) => string} encodeKey
 * @returns {Locator}
 */
export const createObjectLocator = (client, bucketName, encodeKey) =>
  new S3ObjectLocator(client, bucketName, encodeKey)

/** @implements {Locator} */
class S3ObjectLocator {
  /**
   * @param {S3Client} client 
   * @param {string} bucketName 
   * @param {(root: UnknownLink) => string} encodeKey 
   */
  constructor (client, bucketName, encodeKey) {
    this.client = client
    this.bucketName = bucketName
    this.encodeKey = encodeKey
  }

  /** @param {UnknownLink} root */
  async locate (root) {
    console.log(`locating ${root} in ${this.bucketName}`)
    const key = this.encodeKey(root)
    const cmd = new HeadObjectCommand({ Bucket: this.bucketName, Key: key })
    try {
      const res = await this.client.send(cmd)
      const size = res.ContentLength
      if (size == null) throw new Error(`missing ContentLength: ${root}`)
      return { root, client: this.client, bucket: this.bucketName, key, size }
    } catch (/** @type {any} */ err) {
      if (err?.$metadata.httpStatusCode !== 404) {
        throw err
      }
    }
  }
}

/**
 * Creates a client that knows how to locate an object by looking in the legacy
 * DUDEWHERE index bucket to find the key.
 *
 * @param {S3Client} client 
 * @param {string} indexBucketName Name of the DUDEWHERE bucket.
 * @param {string} dataBucketName Name of the CARPARK bucket.
 */
export const createDudeWhereLocator = (client, indexBucketName, dataBucketName) =>
  new DudeWhereLocator(client, indexBucketName, dataBucketName)

/** @implements {Locator} */
class DudeWhereLocator {
  /**
   * @param {S3Client} client
   * @param {string} indexBucketName Name of the DUDEWHERE bucket.
   * @param {string} dataBucketName Name of the CARPARK bucket.
   */
  constructor (client, indexBucketName, dataBucketName) {
    this.client = client
    this.indexBucketName = indexBucketName
    this.dataBucketName = dataBucketName
  }

  /** @param {UnknownLink} root */
  async locate (root) {
    console.log(`locating ${root} in ${this.indexBucketName}`)
    const cmd = new ListObjectsV2Command({
      Bucket: this.indexBucketName,
      MaxKeys: 2,
      Prefix: `${root}/`
    })
    const res = await this.client.send(cmd)
    const contents = res.Contents

    // if there's no items then it simply not found
    if (!contents?.length) return
    // if there's more than one item, then someone else has stored this root,
    // as multiple shards, or with a different block ordering. There's no way
    // to know which subset of shards contains the entire DAG.
    if (contents.length > 1) return
    // if no key then this is a weird situation
    if (!contents[0].Key) return

    const key = contents[0].Key
    const locator = createObjectLocator(this.client, this.dataBucketName, () => {
      const link = Link.parse(key.split('/').pop() ?? '')
      return `${link}/${link}.car`
    })
    return locator.locate(root)
  }
}

/**
 * A hasher that reads data from a location and hashes it.
 *
 * @returns {Hasher}
 */
export const createObjectHasher = () => new ObjectHasher()

/** @implements {Hasher} */
class ObjectHasher {
  /** @param {Location} location */
  async digest (location) {
    console.log(`hashing ${location.key} in ${location.bucket}`)
    const cmd = new GetObjectCommand({ Bucket: location.bucket, Key: location.key })

    const res = await location.client.send(cmd)
    if (!res.Body) {
      throw new NotFound(`Object not found: ${location.root}`) // shouldn't happen
    }

    const hash = crypto.createHash('sha256')
    await res.Body.transformToWebStream()
      .pipeTo(new WritableStream({ write: chunk => { hash.update(chunk) } }))

    const digest = Digest.create(sha256.code, hash.digest())
    return Link.create(CAR_CODEC, digest)
  }
}

/**
 * A hasher that extracts the CAR hash from the key.
 *
 * @returns {Hasher}
 */
export const createHashEncodedInKeyHasher = () => new HashEncodedInKeyHasher()

/** @implements {Hasher} */
class HashEncodedInKeyHasher {
  /** @param {Location} location */
  async digest (location) {
    const filename = location.key.split('/').pop()
    if (!filename || !filename.endsWith('.car')) {
      throw new Error('unexpected key format')
    }
    const hash =
      /** @type {import('multiformats').Link<unknown, number, number, 1>} */ 
      (Link.parse(filename.replace('.car', '')))
    return hash
  }
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
  for (const bucket of buckets) {
    const location = await bucket.locator.locate(root)
    if (!location) continue

    const cmd = new GetObjectCommand({ Bucket: location.bucket, Key: location.key })
    const url = await getSignedUrl(location.client, cmd, { expiresIn: DownloadURLExpiration })
    return new URL(url)
  }
  throw new NotFound(`not found: ${root}`)
}

export class NotFound extends Error {}
