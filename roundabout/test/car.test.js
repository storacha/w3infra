import { test } from './helpers/context.js'

import {
  PutObjectCommand,
} from '@aws-sdk/client-s3'

import { encode } from 'multiformats/block'
import { identity } from 'multiformats/hashes/identity'
import { sha256 as hasher } from 'multiformats/hashes/sha2'
import * as pb from '@ipld/dag-pb'
import { CarBufferWriter } from '@ipld/car'
import { CAR } from '@ucanto/transport'

import { resolveCar, carLocationResolver } from '../index.js'

import { createS3, createBucket } from './helpers/resources.js'

test.before(async t => {
  const { client } = await createS3({ port: 9000 })

  t.context.s3Client = client
})

test('resolves a CAR in a valid R2 bucket claim', async t => {
  const bucketName = await createBucket(t.context.s3Client)
  const carCid = await putCarToBucket(t.context.s3Client, bucketName)
  const expiresIn = 3 * 24 * 60 * 60 // 3 days in seconds

  const locateCar = carLocationResolver({ 
    s3Client: t.context.s3Client,
    expiresIn,
    fetchClaims: (link) => {
      return Promise.resolve([
        { type: 'assert/location', content: link, location: [`https://fffa4b4363a7e5250af8357087263b3a.r2.cloudflarestorage.com/${bucketName}/${link.toString()}/${link.toString()}.car`] }
      ])
    },
    validR2Buckets: [bucketName]
  })

  const response = await resolveCar(carCid, locateCar)
  t.assert(response)
  t.deepEqual(response?.statusCode, 302)
  t.assert(response?.headers.Location)
})

test('resolves CAR in a valid R2 bucket via a S3 bucket claim', async t => {
  const bucketName = await createBucket(t.context.s3Client)
  const carCid = await putCarToBucket(t.context.s3Client, bucketName)
  const expiresIn = 3 * 24 * 60 * 60 // 3 days in seconds

  const locateCar = carLocationResolver({ 
    s3Client: t.context.s3Client,
    expiresIn,
    fetchClaims: (link) => {
      return Promise.resolve([
        { type: 'assert/location', content: link, location: [
          `https://${bucketName}.s3.amazonaws.com/${link.toString()}/${link.toString()}.car`,
        ] }
      ])
    },
    validS3Buckets: [bucketName]
  })

  const response = await resolveCar(carCid, locateCar)
  t.assert(response)
  t.deepEqual(response?.statusCode, 302)
  t.assert(response?.headers.Location)
})

test('falls back to resolve a CAR if not in a valid bucket for claims, but on default', async t => {
  const bucketName = await createBucket(t.context.s3Client)
  const carCid = await putCarToBucket(t.context.s3Client, bucketName)
  const expiresIn = 3 * 24 * 60 * 60 // 3 days in seconds

  const locateCar = carLocationResolver({ 
    s3Client: t.context.s3Client,
    expiresIn,
    fetchClaims: (link) => {
      return Promise.resolve([
        { type: 'assert/location', content: link, location: [
          `https://${bucketName}.s3.amazonaws.com/${link.toString()}/${link.toString()}.car`,
          `https://fffa4b4363a7e5250af8357087263b3a.r2.cloudflarestorage.com/${bucketName}/${link.toString()}/${link.toString()}.car`
        ] }
      ])
    },
    defaultBucketName: bucketName
  })

  const response = await resolveCar(carCid, locateCar)
  t.assert(response)
  t.deepEqual(response?.statusCode, 302)
})

test('does not resolve a CAR if not in a valid bucket', async t => {
  const bucketName = await createBucket(t.context.s3Client)
  const carCid = await CAR.codec.link(new Uint8Array([80, 82, 84, 86]))
  const expiresIn = 3 * 24 * 60 * 60 // 3 days in seconds

  const locateCar = carLocationResolver({ 
    s3Client: t.context.s3Client,
    expiresIn,
    fetchClaims: (link) => {
      return Promise.resolve([
        { type: 'assert/location', content: link, location: [
          `https://${bucketName}.s3.amazonaws.com/${link.toString()}/${link.toString()}.car`,
          `https://fffa4b4363a7e5250af8357087263b3a.r2.cloudflarestorage.com/${bucketName}/${link.toString()}/${link.toString()}.car`
        ] }
      ])
    },
    defaultBucketName: bucketName
  })

  const response = await resolveCar(carCid, locateCar)
  t.assert(response)
  t.deepEqual(response?.statusCode, 404)
})

test('does not resolve a CAR if not available in the bucket but a claim exists', async t => {
  const bucketName = await createBucket(t.context.s3Client)
  await putCarToBucket(t.context.s3Client, bucketName)
  const otherCarLink = await CAR.codec.link(new Uint8Array([80, 82, 84, 86]))
  const expiresIn = 3 * 24 * 60 * 60 // 3 days in seconds

  const locateCar = carLocationResolver({ 
    s3Client: t.context.s3Client,
    expiresIn,
    fetchClaims: (link) => {
      return Promise.resolve([
        { type: 'assert/location', content: link, location: [`https://fffa4b4363a7e5250af8357087263b3a.r2.cloudflarestorage.com/${bucketName}/${otherCarLink.toString()}/${otherCarLink.toString()}.car`] }
      ])
    },
    validR2Buckets: [bucketName]
  })

  const response = await resolveCar(otherCarLink, locateCar)
  t.assert(response)
  t.deepEqual(response?.statusCode, 404)
})

/**
 * @param {import('@aws-sdk/client-s3').S3Client} s3Client
 * @param {string} bucketName 
 */
async function putCarToBucket (s3Client, bucketName) {
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

  const link = await CAR.codec.link(car.bytes)
  const key = `${link.toString()}/${link.toString()}.car`
  await s3Client.send(
    new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      Body,
    })
  )

  return link
}
