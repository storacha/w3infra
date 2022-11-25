import { test } from './helpers/context.js'

import {
  GetObjectCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3'
import { encode } from 'multiformats/block'
import { identity } from 'multiformats/hashes/identity'
import { sha256 as hasher } from 'multiformats/hashes/sha2'
import * as pb from '@ipld/dag-pb'
import { CarBufferWriter } from '@ipld/car'
import { equals, toString } from 'uint8arrays'
import { MultihashIndexSortedReader } from 'cardex'

import { createS3, createBucket } from './helpers/resources.js'
import { carReplicateAndIndex } from '../replicator.js'

test('copy CARs from origin bucket to replicator bucket and creates index', async t => {
  const { client: originBucket } = await createS3({ port: 9000 })
  const { client: destinationBucket } = await createS3({ port: 9000 })
  const originBucketId = await createBucket(originBucket)
  const destinationBucketCarName = await createBucket(destinationBucket)
  const destinationBucketSideIndexName = await createBucket(destinationBucket)

  // Write original car to origin bucket
  const id = await encode({
    value: pb.prepare({ Data: 'a red car on the street!' }),
    codec: pb,
    hasher: identity,
  })
  const parent = await encode({
    value: pb.prepare({ Links: [id.cid] }),
    codec: pb,
    hasher,
  })
  const car = CarBufferWriter.createWriter(Buffer.alloc(1000), {
    roots: [parent.cid],
  })
  car.write(parent)

  const Body = car.close()
  const digest = await hasher.digest(Body)
  const checksum = toString(digest.digest, 'base64pad')

  const key = `${parent.cid.toString()}/${parent.cid.toString()}`
  await originBucket.send(
    new PutObjectCommand({
      Bucket: originBucketId,
      Key: key,
      Body,
      ChecksumSHA256: checksum,
    })
  )

  const record = {
    bucketName: originBucketId,
    bucketRegion: 'us-east-2',
    key,
  }

  await carReplicateAndIndex({
    record,
    destinationBucket,
    originBucket,
    destinationBucketCarName,
    destinationBucketSideIndexName,
  })

  // Check if written files exist
  const copiedCarResponse = await destinationBucket.send(
    new GetObjectCommand({
      Bucket: destinationBucketCarName,
      Key: key,
    })
  )
  t.is(copiedCarResponse.$metadata.httpStatusCode, 200)

  const createdSideIndexResponse = await destinationBucket.send(
    new GetObjectCommand({
      Bucket: destinationBucketSideIndexName,
      Key: key + '.idx',
    })
  )
  t.is(createdSideIndexResponse.$metadata.httpStatusCode, 200)

  // Validate Side indexer
  const reader = MultihashIndexSortedReader.fromIterable(
    // @ts-ignore
    createdSideIndexResponse.Body
  )
  let isRootBlockIndexed = false
  for await (const entry of reader.entries()) {
    if (equals(entry.digest, parent.cid.multihash.digest)) {
      isRootBlockIndexed = true
    }
  }
  t.truthy(isRootBlockIndexed)
})
