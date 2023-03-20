import { test } from './helpers/context.js'
import { createS3, createBucket } from './helpers/resources.js'
import { createSpace } from './helpers/ucan.js'

import { HeadObjectCommand } from '@aws-sdk/client-s3'
import { toString } from 'uint8arrays/to-string'
import * as Signer from '@ucanto/principal/ed25519'
import { CAR } from '@ucanto/transport'
import * as ucanto from '@ucanto/core'
// @ts-expect-error
import lambdaUtils from 'aws-lambda-test-utils'

import { processUcanInvocation } from '../ucan-invocation.js'
import { useUcanStore } from '../buckets/ucan-store.js'

test.before(async (t) => {
  const { client: s3 } = await createS3({
    port: 9000,
  })

  t.context.s3 = s3
})

test('can process a given ucan invocation', async t => {
  const { bucketName } = await prepareResources(t.context.s3)
  const basicAuth = 'test-token'
  const storeBucket = useUcanStore(t.context.s3, bucketName)

  // Create UCAN invocation
  const uploadService = await Signer.generate()
  const alice = await Signer.generate()
  const { proof, spaceDid } = await createSpace(alice)

  const data = new Uint8Array([11, 22, 34, 44, 55])
  const link = await CAR.codec.link(data)
  const nb = { link, size: data.byteLength }
  const can = 'store/add'
  const car = await CAR.encode([
    await ucanto.delegate({
      issuer: alice,
      audience: uploadService,
      capabilities: [
        {
          can,
          with: spaceDid,
          nb,
        },
      ],
      proofs: [proof],
    }),
  ])

  const request = lambdaUtils.mockEventCreator.createAPIGatewayEvent({
    headers: {
      Authorization: `Basic ${basicAuth}`
    },
    body: toString(car.body, 'base64')
  })

  // Handles invocation
  await t.notThrowsAsync(() => processUcanInvocation(request, {
    storeBucket,
    basicAuth
  }))

  // Verify invocation persisted
  const decodedCar = await CAR.codec.decode(car.body)
  const carCid = decodedCar.roots[0].cid.toString()

  const cmd = new HeadObjectCommand({
    Key: `${carCid}/${carCid}.car`,
    Bucket: bucketName,
  })
  const s3Response = await t.context.s3.send(cmd)
  t.is(s3Response.$metadata.httpStatusCode, 200)
})

test('fails to process request with no Authorization header', async t => {
  const { bucketName } = await prepareResources(t.context.s3)
  const basicAuth = 'test-token'
  const storeBucket = useUcanStore(t.context.s3, bucketName)
  const request = lambdaUtils.mockEventCreator.createAPIGatewayEvent()

  await t.throwsAsync(() => processUcanInvocation(request, {
    storeBucket,
    streamName: 'name',
    basicAuth
  }))
})

test('fails to process request with no Authorization basic header', async t => {
  const { bucketName } = await prepareResources(t.context.s3)
  const basicAuth = 'test-token'
  const storeBucket = useUcanStore(t.context.s3, bucketName)
  const request = lambdaUtils.mockEventCreator.createAPIGatewayEvent({
    headers: {
      Authorization: 'Bearer token-test'
    }
  })

  await t.throwsAsync(() => processUcanInvocation(request, {
    storeBucket,
    basicAuth
  }))
})

test('fails to process request with Authorization basic token empty', async t => {
  const { bucketName } = await prepareResources(t.context.s3)
  const basicAuth = 'test-token'
  const storeBucket = useUcanStore(t.context.s3, bucketName)
  const request = lambdaUtils.mockEventCreator.createAPIGatewayEvent({
    headers: {
      Authorization: 'Basic'
    }
  })

  await t.throwsAsync(() => processUcanInvocation(request, {
    storeBucket,
    basicAuth
  }))
})

test('fails to process request with invalid Authorization basic token', async t => {
  const { bucketName } = await prepareResources(t.context.s3)
  const basicAuth = 'test-token'
  const storeBucket = useUcanStore(t.context.s3, bucketName)
  const request = lambdaUtils.mockEventCreator.createAPIGatewayEvent({
    headers: {
      Authorization: 'Basic invalid-token'
    }
  })

  await t.throwsAsync(() => processUcanInvocation(request, {
    storeBucket,
    basicAuth
  }))
})

/**
 * @param {import("@aws-sdk/client-s3").S3Client} s3Client
 */
async function prepareResources(s3Client) {
  const bucketName = await createBucket(s3Client)

  return {
    bucketName,
  }
}
