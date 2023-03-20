import { s3 as test } from '../helpers/context.js'

import { GetObjectCommand } from '@aws-sdk/client-s3'
import * as Signer from '@ucanto/principal/ed25519'
import { CAR } from '@ucanto/transport'
import * as UCAN from '@ipld/dag-ucan'
import * as ucanto from '@ucanto/core'

import { createS3, createBucket } from '../helpers/resources.js'
import { randomCAR } from '../helpers/random.js'
import { createSpace } from '../helpers/ucan.js'

import { useUcanStore } from '../../buckets/ucan-store.js'
import {
  parseUcanInvocationRequest,
  persistUcanInvocation,
  replaceAllLinkValues,
} from '../../ucan-invocation.js'

test.before(async (t) => {
  const { client: s3 } = await createS3({
    port: 9000,
  })

  t.context.s3 = s3
})

test('parses ucan invocation request', async (t) => {
  const uploadService = await Signer.generate()
  const alice = await Signer.generate()
  const { proof, spaceDid } = await createSpace(alice)

  const data = new Uint8Array([11, 22, 34, 44, 55])
  const link = await CAR.codec.link(data)
  const nb = { link, size: data.byteLength }
  const can = 'store/add'

  const request = await CAR.encode([
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

test('persists ucan invocation CAR file', async (t) => {
  const { bucketName } = await prepareResources(t.context.s3)
  const ucanStore = useUcanStore(t.context.s3, bucketName)

  const uploadService = await Signer.generate()
  const alice = await Signer.generate()
  const { proof, spaceDid } = await createSpace(alice)

  const data = new Uint8Array([11, 22, 34, 44, 55])
  const link = await CAR.codec.link(data)
  const nb = { link, size: data.byteLength }
  const can = 'store/add'

  const request = await CAR.encode([
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

  // @ts-expect-error different type interface in AWS expected request
  const ucanInvocationObject = await parseUcanInvocationRequest(request)
  await persistUcanInvocation(ucanInvocationObject, ucanStore)

  const requestCar = await CAR.codec.decode(request.body)
  const requestCarRootCid = requestCar.roots[0].cid.toString()

  const cmd = new GetObjectCommand({
    Key: `${requestCarRootCid}/${requestCarRootCid}.car`,
    Bucket: bucketName,
  })
  const s3Response = await t.context.s3.send(cmd)
  t.is(s3Response.$metadata.httpStatusCode, 200)

  // @ts-expect-error AWS types with readable stream
  const bytes = (await s3Response.Body.toArray())[0]

  const storedCar = await CAR.codec.decode(bytes)
  const storedCarRootCid = storedCar.roots[0].cid.toString()

  t.is(requestCarRootCid, storedCarRootCid)
  // @ts-expect-error unkown ByteView type
  const ucan = UCAN.decode(storedCar.roots[0].bytes)

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

test('replace all link values as object and array', async (t) => {
  const car = await randomCAR(128)
  const otherCar = await randomCAR(40)

  // invoke a upload/add with proof
  const root = car.roots[0]
  const shards = [car.cid, otherCar.cid].sort()

  const att = [
    {
      nb: {
        link: root,
        size: car.size,
      },
      can: 'store/add',
      with: 'did:key:z6MkfTDbhRZz26kcDNmmehPxeujSkbXe8jqv5fLpKvtc3Wcv',
    },
    {
      nb: {
        root,
        shards: [...shards],
      },
      can: 'upload/add',
      with: 'did:key:z6MkfTDbhRZz26kcDNmmehPxeujSkbXe8jqv5fLpKvtc3Wcv',
    },
  ]

  att.map(replaceAllLinkValues)

  // Object with Link
  // @ts-expect-error Property '/' does not exist on type 'Link<Partial<Model>
  t.is(att[0].nb.link['/'], root.toString())
  // @ts-expect-error Property '/' does not exist on type 'Link<Partial<Model>
  t.is(att[1].nb.root['/'], root.toString())

  // Array with Link
  t.deepEqual(
    // @ts-expect-error Property '/' does not exist on type 'Link<Partial<Model>
    att[1].nb.shards?.map((s) => s['/']),
    shards.map((s) => s.toString())
  )
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
