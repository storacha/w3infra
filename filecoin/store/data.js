import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand
} from '@aws-sdk/client-s3'
import * as CAR from '@ucanto/transport/car'
import { sha256 } from 'multiformats/hashes/sha2'
import { CID } from 'multiformats/cid'
import * as raw from 'multiformats/codecs/raw'
import { CarWriter } from '@ipld/car'
import pRetry from 'p-retry'
import { StoreOperationFailed, RecordNotFound } from '@web3-storage/filecoin-api/errors'

/**
 * Abstraction layer with Factory to perform operations on bucket storing
 * data receipts.
 *
 * @param {string} region
 * @param {string} bucketName
 * @param {import('@aws-sdk/client-s3').ServiceInputTypes} [options]
 */
export function createDataStore(region, bucketName, options = {}) {
  const s3client = new S3Client({
    region,
    ...options,
  })
  return useDataStore(s3client, bucketName)
}

/**
 * @param {S3Client} s3client
 * @param {string} bucketName
 * @returns {import('@web3-storage/filecoin-api/storefront/api').DataStore}
 */
export const useDataStore = (s3client, bucketName) => {
  return {
    // Only used for testing storing a CAR
    // until we hook up claims to look for data
    put: async (bytes) => {
      const hash = await sha256.digest(bytes)
      const root = CID.create(1, raw.code, hash)

      const { writer, out } = CarWriter.create(root)
      writer.put({ cid: root, bytes })
      writer.close()

      const chunks = []
      for await (const chunk of out) {
        chunks.push(chunk)
      }
      const blob = new Blob(chunks)
      const cid = await CAR.codec.link(new Uint8Array(await blob.arrayBuffer()))

      const putCmd = new PutObjectCommand({
        Bucket: bucketName,
        Key: `${cid.toString()}/${cid.toString()}.car`,
        Body: bytes
      })
      await s3client.send(putCmd)

      return {
        ok: {}
      }
    },
    /**
     * Stream Blob bytes for a given invocation.
     */
    /**
     * 
     * @param {import('@ucanto/interface').UnknownLink} cid 
     */
    // @ts-expect-error aws Readable stream types are not good
    stream: async (cid) => {
      // TODO: probably get from Roundabout from R2 when location claims?
      const getObjectCmd = new GetObjectCommand({
        Bucket: bucketName,
        Key: `${cid.toString()}/${cid.toString()}.car`,
      })
      let res

      try {
        res = await pRetry(() => s3client.send(getObjectCmd), { retries: 3 })
      } catch (/** @type {any} */ error) {
        if (error?.$metadata?.httpStatusCode === 404) {
          return {
            error: new RecordNotFound(`blob ${cid.toString()} not found in store`)
          }
        }
        return {
          error: new StoreOperationFailed(error.message)
        }
      }
      
      const stream = res.Body
      if (!stream) {
        return {
          error: new RecordNotFound(`blob ${cid.toString()} not found in store`)
        }
      }

      return {
        ok: stream
      }
    },
    has: async () => {
      return {
        error: new StoreOperationFailed('no blob should checked by storefront')
      }
    }
  }
}

/**
 * compose many data stores.
 * store#stream will check stores in order until 0-1 `ok` result is found.
 * 
 * @param  {import('@web3-storage/filecoin-api/storefront/api').DataStore} dataStore
 * @param  {Array<import('@web3-storage/filecoin-api/storefront/api').DataStore>} moreDataStores
 * @returns {import('@web3-storage/filecoin-api/storefront/api').DataStore}
 */
export function composeDataStoresWithOrderedStream(dataStore, ...moreDataStores) {
  return {
    ...dataStore,
    stream: composeSome(dataStore.stream, ...moreDataStores.map(s => s.stream.bind(s))),
  }
}

/**
 * @typedef {AsyncIterable<Uint8Array>} Rec
 * @typedef {import('@web3-storage/filecoin-api/types').StoreGetError} StoreGetError
 * @typedef {import('@ucanto/interface').Result<Rec, StoreGetError>} Result
 */

/**
 * compose async functions that return Promise<Result<Rec, StoreGetError>>.
 * The returned function will have the same signature,
 * but will try the composed functions in order until one (or none) returns 'ok'.
 * 
 * @template T
 * @param  {Array<(e: T) => Promise<Result>>} streamFunctions
 * 
 */
function composeSome(...streamFunctions) {
  /**
   * @param {T} e
   */
  return async function (e) {
    /** @type {Result | undefined} */
    let result
    for (const stream of streamFunctions) {
      result = await stream(e)
      if (result.ok) {
        return result
      }
    }
    if (result === undefined) {
      throw new Error('no result received')
    }
    return result
  }
}