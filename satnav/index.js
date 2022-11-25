import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3'

import { MultihashIndexSortedWriter } from 'cardex'
import { CarIndexer } from '@ipld/car/indexer'
import { concat as uint8arraysConcat } from 'uint8arrays'
import { base64pad } from 'multiformats/bases/base64'
import { sha256 } from 'multiformats/hashes/sha2'

/**
 * @typedef {import('@aws-sdk/client-s3').S3Client} S3Client
 */

/**
 * Create CAR side index and write it to Satnav bucket if non existing.
 *
 * @param {object} props
 * @param {import('./utils/parse-sqs-event').EventRecord} props.record
 * @param {S3Client} props.s3Client
 * @param {string} props.satnavBucketName
 */
export async function writeSatnavIndex({
  record,
  s3Client,
  satnavBucketName
}) {
  const key = record.key
  const indexKey = `${record.key}.idx`

  // Verify if INDEX already exist in destination bucket
  try {
    await s3Client.send(
      new HeadObjectCommand({
        Bucket: satnavBucketName,
        Key: indexKey,
      })
    )
  } catch {
    // Not in satnavBucket, so create index and write it to bucket
    // Get CAR file to create index
    const getCmd = new GetObjectCommand({
      Bucket: record.bucketName,
      Key: key,
    })

    const res = await s3Client.send(getCmd)
    if (!res.Body) {
      throw new Error('invalid CAR file retrieved')
    }

    try {
      // @ts-expect-error Stream types from aws SDK are different
      const sideIndex = await getSideIndex(res.Body)
      const sideIndexdigest = await sha256.digest(sideIndex)
      const checksum = base64pad.baseEncode(sideIndexdigest.digest)

      // Write Side Index
      const putCmd = new PutObjectCommand({
        Bucket: satnavBucketName,
        Key: indexKey,
        Body: sideIndex,
        ChecksumSHA256: checksum,
      })
  
      await s3Client.send(putCmd)
    } catch (error) {
      throw new Error('error saving car to replicator bucket:' + error)
    }
  }
}

/**
 * Build the side index.
 *
 * @param {AsyncIterable<Uint8Array>} stream
 * @returns
 */
export async function getSideIndex(stream) {
  const { writer, out } = MultihashIndexSortedWriter.create()
  /** @type {Error?} */
  let failError

  const fillWriterWithIndexBlocks = async () => {
    try {
      const indexer = await CarIndexer.fromIterable(stream)
      for await (const blockIndexData of indexer) {
        // @ts-ignore CID versions incompatible
        await writer.put(blockIndexData)
      }
    } catch (/** @type {any} */ error) {
      failError = error
    } finally {
      await writer.close()
    }
  }

  // call here, but don't await so it does this async
  fillWriterWithIndexBlocks()

  const chunks = []
  for await (const chunk of out) {
    chunks.push(chunk)
  }

  // @ts-ignore ts being ts
  if (failError) {
    throw failError
  }


  return uint8arraysConcat(chunks)
}
