import { test } from './helpers/context.js'

import {
  GetObjectCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3'

import { encode } from 'multiformats/block'
import { identity } from 'multiformats/hashes/identity'
import { sha256 as hasher } from 'multiformats/hashes/sha2'
import * as pb from '@ipld/dag-pb'
import { CarBufferWriter, CarWriter } from '@ipld/car'
import { equals, toString } from 'uint8arrays'
import { MultihashIndexSortedReader } from 'cardex'

import { createS3, createBucket } from './helpers/resources.js'
import { writeSatnavIndex, getSideIndex } from '../index.js'

test.before(async t => {
  const { client } = await createS3({ port: 9000 })

  t.context.s3Client = client
})

test('creates side index and writes to satnav bucket', async t => {
  const carparkBucketName = await createBucket(t.context.s3Client)
  const satnavBucketName = await createBucket(t.context.s3Client)

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
  await t.context.s3Client.send(
    new PutObjectCommand({
      Bucket: carparkBucketName,
      Key: key,
      Body,
      ChecksumSHA256: checksum,
    })
  )

  const record = {
    bucketName: carparkBucketName,
    bucketRegion: 'us-west-2',
    key,
  }

  await writeSatnavIndex({
    record,
    s3Client: t.context.s3Client,
    satnavBucketName
  })

  // Check if satnav index file was written
  const createdSideIndexResponse = await t.context.s3Client.send(
    new GetObjectCommand({
      Bucket: satnavBucketName,
      Key: key + '.idx',
    })
  )
  t.is(createdSideIndexResponse.$metadata.httpStatusCode, 200)

  // Validate Side index
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

test('fails if carpark bucket does not have event target file', async t => {
  const carparkBucketName = await createBucket(t.context.s3Client)
  const satnavBucketName = await createBucket(t.context.s3Client)

  const id = await encode({
    value: pb.prepare({ Data: 'a red car on the street!' }),
    codec: pb,
    hasher: identity,
  })

  const key = `${id.cid.toString()}/${id.cid.toString()}`

  const record = {
    bucketName: carparkBucketName,
    bucketRegion: 'us-west-2',
    key,
  }

  await t.throwsAsync(() => writeSatnavIndex({
    record,
    s3Client: t.context.s3Client,
    satnavBucketName
  }))
})

test('does not re-create side index if already existing', async t => {
  const carparkBucketName = await createBucket(t.context.s3Client)
  const satnavBucketName = await createBucket(t.context.s3Client)

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

  const { writer, out } = await CarWriter.create([parent.cid])
  writer.put(parent)

  const [sideIndex, ] = await Promise.all([
    getSideIndex(out),
    writer.close()
  ])
  
  const key = `${parent.cid.toString()}/${parent.cid.toString()}`
  await t.context.s3Client.send(
    new PutObjectCommand({
      Bucket: satnavBucketName,
      Key: `${key}.idx`,
      Body: sideIndex,
      Metadata: {
        first: 'true'
      }
    })
  )

  const record = {
    bucketName: carparkBucketName,
    bucketRegion: 'us-west-2',
    key,
  }

  await writeSatnavIndex({
    record,
    s3Client: t.context.s3Client,
    satnavBucketName
  })

  const createdSideIndexResponse = await t.context.s3Client.send(
    new GetObjectCommand({
      Bucket: satnavBucketName,
      Key: key + '.idx',
    })
  )
  t.is(createdSideIndexResponse.$metadata.httpStatusCode, 200)
  t.is(createdSideIndexResponse.Metadata?.first, 'true')
})
