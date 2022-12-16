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
import { toString } from 'uint8arrays'

import { getSideIndex } from '../../satnav/index.js'
import { createS3, createBucket } from './helpers/resources.js'
import { replicate, writeToBucket } from '../index.js'

test.before(async t => {
  const { client } = await createS3({ port: 9000 })

  t.context.s3Client = client
})

test('copy CARs from origin bucket to replicator bucket', async t => {
  const originBucketName = await createBucket(t.context.s3Client)
  const destinationBucketName = await createBucket(t.context.s3Client)

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
  await t.context.s3Client.send(
    new PutObjectCommand({
      Bucket: originBucketName,
      Key: key,
      Body,
      ChecksumSHA256: checksum,
    })
  )

  const record = {
    bucketName: originBucketName,
    bucketRegion: 'us-west-2',
    key,
  }

  await replicate({
    record,
    destinationBucket: t.context.s3Client,
    originBucket: t.context.s3Client,
    destinationBucketName
  })

  // Check if written files exist
  const copiedCarResponse = await t.context.s3Client.send(
    new GetObjectCommand({
      Bucket: destinationBucketName,
      Key: key,
    })
  )
  t.is(copiedCarResponse.$metadata.httpStatusCode, 200)
})

test('copy satnav index to replicator bucket', async t => {
  const originBucketName = await createBucket(t.context.s3Client)
  const destinationBucketName = await createBucket(t.context.s3Client)

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

  const key = `${parent.cid.toString()}/${parent.cid.toString()}.idx`
  await t.context.s3Client.send(
    new PutObjectCommand({
      Bucket: originBucketName,
      Key: key,
      Body: sideIndex,
      Metadata: {
        first: 'true'
      }
    })
  )

  const record = {
    bucketName: originBucketName,
    bucketRegion: 'us-west-2',
    key,
  }

  await replicate({
    record,
    destinationBucket: t.context.s3Client,
    originBucket: t.context.s3Client,
    destinationBucketName
  })

  // Check if written files exist
  const copiedCarResponse = await t.context.s3Client.send(
    new GetObjectCommand({
      Bucket: destinationBucketName,
      Key: key,
    })
  )
  t.is(copiedCarResponse.$metadata.httpStatusCode, 200)
})

test('write to bucket fails with invalid md5', async t => {
  const originBucketName = await createBucket(t.context.s3Client)
  const destinationBucketName = await createBucket(t.context.s3Client)

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
  await t.context.s3Client.send(
    new PutObjectCommand({
      Bucket: originBucketName,
      Key: key,
      Body,
      ChecksumSHA256: checksum,
    })
  )

  const writtenCar = await t.context.s3Client.send(
    new GetObjectCommand({
      Bucket: originBucketName,
      Key: key,
    })
  )

  await t.throwsAsync(() => writeToBucket(
    key,
    // @ts-expect-error
    writtenCar.Body,
    destinationBucketName,
    t.context.s3Client,
    {
      md5: writtenCar.ETag // invalid encoding
    }
  ))
})
