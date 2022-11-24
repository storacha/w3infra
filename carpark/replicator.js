import Stream from 'stream'
import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3'
import { MultihashIndexSortedWriter } from 'cardex'
import { CarIndexer } from '@ipld/car/indexer'
import { concat as uint8arraysConcat } from 'uint8arrays'

/**
 * @typedef {import('@aws-sdk/client-s3').S3Client} S3Client
 */

/**
 * Replicate event target into destination bucket and write a side index for it.
 *
 * @param {object} props
 * @param {import('./utils/parse-sqs-event').EventRecord} props.record
 * @param {S3Client} props.destinationBucket
 * @param {S3Client} props.originBucket
 * @param {string} props.destinationBucketCarName
 * @param {string} props.destinationBucketSideIndexName
 */
 export const carReplicateAndIndex = async ({
  record,
  destinationBucket,
  destinationBucketCarName,
  destinationBucketSideIndexName,
  originBucket,
}) => {
  const key = record.key

  // Verify if event CAR and INDEX already exist in destination bucket
  try {
    const checkIfCarExists = destinationBucket.send(
      new HeadObjectCommand({
        Bucket: destinationBucketCarName,
        Key: key,
      })
    )
    const checkIfIndexExists = destinationBucket.send(
      new HeadObjectCommand({
        Bucket: destinationBucketSideIndexName,
        Key: key + '.idx',
      })
    )
    await Promise.all([checkIfCarExists, checkIfIndexExists])
  } catch {
    // Not in destinationBucket, so read from origin bucket and write to destination bucket
    const getCmd = new GetObjectCommand({
      Bucket: record.bucketName,
      Key: key,
    })

    // TODO: md5
    const res = await originBucket.send(getCmd)
    if (!res.Body) {
      throw new Error('invalid CAR file retrieved')
    }

    // Get 2 streams passthrough from origin bucket readable stream
    // @ts-expect-error aws types body does not include pipe...
    const stream1 = res.Body.pipe(new Stream.PassThrough())
    // @ts-expect-error aws types body does not include pipe...
    const stream2 = res.Body.pipe(new Stream.PassThrough())

    // Write CAR copy, while creating side index
    await Promise.all([
      writeCarToBucket(key, stream1, destinationBucketCarName, destinationBucket, { contentLength: res.ContentLength }),
      writeIndexToBucket(`${key}.idx`, stream2, destinationBucketSideIndexName, destinationBucket)
    ])
  }
}

/**
 * @param {string} key
 * @param {Stream.Readable} body
 * @param {string} bucketName
 * @param {S3Client} client
 * @param {object} [options]
 * @param {number} [options.contentLength]
 */
async function writeCarToBucket(key, body, bucketName, client, options = {}) {
  try {
    const putCmd = new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      Body: body,
      // TODO: md5
      ContentLength: options.contentLength,
    })

    await client.send(putCmd)
  } catch (error) {
    throw new Error('error saving car to R2:' + error)
  }
}

/**
 * @param {string} key
 * @param {Stream.Readable} stream
 * @param {string} bucketName
 * @param {S3Client} client
 */
async function writeIndexToBucket(key, stream, bucketName, client) {
  try {
    const sideIndex = await getSideIndex(stream)
    // Write Side Index
    const putCmd = new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      Body: sideIndex,
      // TODO: md5
    })

    await client.send(putCmd)
  } catch (error) {
    throw new Error('error saving car to replicator bucket:' + error)
  }
}

/**
 * Build the side index.
 *
 * @param {AsyncIterable<Uint8Array>} stream
 * @returns
 */
 async function getSideIndex(stream) {
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
