import { test } from './helpers/context.js'

import { PutObjectCommand } from '@aws-sdk/client-s3'

import { createS3, createBucket } from './helpers/resources.js'
import { createCar } from './helpers/car.js'

import { computePieceCid } from '../index.js'

test.before(async t => {
  // S3
  const { client, stop: s3Stop } = await createS3({ port: 9000 })

  Object.assign(t.context, {
    s3Client: client,
    stop: async () => {
      await s3Stop()
    }
  })
})

test.after(async t => {
  await t.context.stop()
})

test('computes piece CID from a CAR file in the bucket', async t => {
  const { bucketName } = await prepareResources(t.context.s3Client)
  const { body, checksum, key, piece, link } = await createCar()
  await t.context.s3Client.send(
    new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      Body: body,
      ChecksumSHA256: checksum,
    })
  )
  const record = {
    bucketName,
    bucketRegion: 'us-west-2',
    key,
  }

  const { ok, error } = await computePieceCid({
    record,
    s3Client: t.context.s3Client,
  })
  t.truthy(ok)
  t.falsy(error)

  t.is(ok?.piece.toString(), piece.toString())
  t.is(ok?.content.toString(), link.toString())
})

/**
 * @param {import("@aws-sdk/client-s3").S3Client} s3Client
 */
async function prepareResources (s3Client) {
  const [ bucketName ] = await Promise.all([
    createBucket(s3Client)
  ])

  return {
    bucketName
  }
}
