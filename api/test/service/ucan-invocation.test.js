import { testUcanInvocation as test } from '../helpers/context.js'

import { HeadObjectCommand } from '@aws-sdk/client-s3'
import * as Signer from '@ucanto/principal/ed25519'
import { CAR } from '@ucanto/transport'
import * as UCAN from '@ipld/dag-ucan'

import { createSpace } from '../helpers/ucanto.js'
import { createS3, createBucket } from '../helpers/resources.js'

import { createUcanStore } from '../../buckets/ucan-store.js'
import { parseUcanInvocationRequest, persistUcanInvocation } from '../../ucan-invocation.js'

test.before(async t => {
  const { client: s3Client, clientOpts: s3ClientOpts } = await createS3({ port: 9000 })

  t.context.s3Client = s3Client
  t.context.s3ClientOpts = s3ClientOpts
})

test('parses ucan invocation request', async t => {
  const uploadService = await Signer.generate()
  const alice = await Signer.generate()
  const { proof, spaceDid } = await createSpace(alice)

  const data = new Uint8Array([11, 22, 34, 44, 55])
  const link = await CAR.codec.link(data)
  const nb = { link, size: data.byteLength }
  const can = 'store/add'

  const request = await CAR.encode([
    {
      issuer: alice,
      audience: uploadService,
      capabilities: [{
        can,
        with: spaceDid,
        nb
      }],
      proofs: [proof],
    }
  ])

  // @ts-expect-error different type interface in AWS expected request
  const ucanInvocationObject = await parseUcanInvocationRequest(request)

  const requestCar = await CAR.codec.decode(request.body)
  const requestCarRootCid = requestCar.roots[0].cid

  t.is(ucanInvocationObject.carCid, requestCarRootCid.toString())
  t.truthy(ucanInvocationObject.bytes)

  // Decode and validate bytes
  const ucanCar = await CAR.codec.decode(ucanInvocationObject.bytes)
  // @ts-expect-error UCAN.View<UCAN.Capabilities> inferred as UCAN.View<unknown>
  const ucan = UCAN.decode(ucanCar.roots[0].bytes)

  t.is(ucan.iss.did(), alice.did())
  t.is(ucan.aud.did(), uploadService.did())
  t.deepEqual(ucan.prf, [proof.root.cid])  
  t.is(ucan.att.length, 1)
  t.like(ucan.att[0], {
    nb,
    can,
    with: spaceDid,
  })
})

test('persists ucan invocation CAR file', async t => {
  const { bucketName } = await prepareResources(t.context.s3Client)
  const ucanStore = createUcanStore('us-west-2', bucketName, t.context.s3ClientOpts)

  const uploadService = await Signer.generate()
  const alice = await Signer.generate()
  const { proof, spaceDid } = await createSpace(alice)

  const data = new Uint8Array([11, 22, 34, 44, 55])
  const link = await CAR.codec.link(data)
  const nb = { link, size: data.byteLength }
  const can = 'store/add'

  const request = await CAR.encode([
    {
      issuer: alice,
      audience: uploadService,
      capabilities: [{
        can,
        with: spaceDid,
        nb
      }],
      proofs: [proof],
    }
  ])

  // @ts-expect-error different type interface in AWS expected request
  const ucanInvocationObject = await parseUcanInvocationRequest(request)
  await persistUcanInvocation(ucanInvocationObject, ucanStore)

  const requestCar = await CAR.codec.decode(request.body)
  const requestCarRootCid = requestCar.roots[0].cid

  const cmd = new HeadObjectCommand({
    Key: requestCarRootCid.toString(),
    Bucket: bucketName,
  })
  const s3Response = await t.context.s3Client.send(cmd)
  t.is(s3Response.$metadata.httpStatusCode, 200)
})

/**
 * @param {import("@aws-sdk/client-s3").S3Client} s3Client
 */
async function prepareResources (s3Client) {
  const bucketName = await createBucket(s3Client)

  return {
    bucketName
  }
}
