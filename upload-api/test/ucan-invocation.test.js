import { s3 as test } from './helpers/context.js'

import { GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3'
import * as Signer from '@ucanto/principal/ed25519'
import { CAR } from '@ucanto/transport'
import * as UCAN from '@ipld/dag-ucan'
import * as ucanto from '@ucanto/core'
import { add as storeAdd } from '@web3-storage/capabilities/store'
import { add as uploadAdd } from '@web3-storage/capabilities/upload'
import { toString } from 'uint8arrays/to-string'
// @ts-expect-error
import lambdaUtils from 'aws-lambda-test-utils'

import { createS3, createBucket } from './helpers/resources.js'
import { randomCAR } from './helpers/random.js'
import { createSpace } from './helpers/ucan.js'

import { useUcanStore } from '../buckets/ucan-store.js'
import {
  parseInvocationsCarRequest,
  persistInvocationsCar,
  replaceAllLinkValues,
  processInvocationsCar
} from '../ucan-invocation.js'


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
  const ucanInvocationObject = await parseInvocationsCarRequest(request)

  const requestCar = await CAR.codec.decode(request.body)
  const requestCarRootCid = requestCar.roots[0].cid

  t.is(ucanInvocationObject.cid, requestCarRootCid.toString())
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
  const ucanInvocationObject = await parseInvocationsCarRequest(request)
  await persistInvocationsCar(ucanInvocationObject, ucanStore)

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

test('can process a given CAR with one ucan invocation', async t => {
  t.plan(5)
  const { bucketName } = await prepareResources(t.context.s3)
  const basicAuth = 'test-token'
  const streamName = 'stream-name'
  const storeBucket = useUcanStore(t.context.s3, bucketName)

  // Create CAR with one UCAN invocation
  const data = new Uint8Array([11, 22, 34, 44, 55])
  const link = await CAR.codec.link(data)

  const car = await CAR.encode([
    await createUcanInvocation(
      storeAdd.can,
      { link, size: data.byteLength }
    )
  ])
  const decodedCar = await CAR.codec.decode(car.body)

  const request = lambdaUtils.mockEventCreator.createAPIGatewayEvent({
    headers: {
      Authorization: `Basic ${basicAuth}`
    },
    body: toString(car.body, 'base64')
  })

  // Handles invocation
  await t.notThrowsAsync(() => processInvocationsCar(request, {
    storeBucket,
    basicAuth,
    streamName,
    kinesisClient: {
      // @ts-expect-error not same return type
      putRecords: (input) => {
        t.is(input.StreamName, streamName)
        t.is(input.Records?.length, decodedCar.roots.length)
        for (const record of input.Records || []) {
          if (!record.Data) {
            throw new Error('must have Data')
          }
          const invocation = JSON.parse(toString(record.Data))
          t.truthy(invocation)
        }
        return Promise.resolve()
      }
    }
  }))

  // Verify invocation persisted
  const carCid = decodedCar.roots[0].cid.toString()

  const cmd = new HeadObjectCommand({
    Key: `${carCid}/${carCid}.car`,
    Bucket: bucketName,
  })
  const s3Response = await t.context.s3.send(cmd)
  t.is(s3Response.$metadata.httpStatusCode, 200)
})

test('can process a given CAR with multiple ucan invocations', async t => {
  t.plan(6)
  const { bucketName } = await prepareResources(t.context.s3)
  const basicAuth = 'test-token'
  const streamName = 'stream-name'
  const storeBucket = useUcanStore(t.context.s3, bucketName)

  // Create CAR with one UCAN invocation
  const data = new Uint8Array([11, 22, 34, 44, 55])
  const link = await CAR.codec.link(data)
  const car = await CAR.encode([
    await createUcanInvocation(
      storeAdd.can,
      { link, size: data.byteLength }
    ),
    await createUcanInvocation(
      uploadAdd.can,
      { root: link }
    )
  ])
  const decodedCar = await CAR.codec.decode(car.body)

  const request = lambdaUtils.mockEventCreator.createAPIGatewayEvent({
    headers: {
      Authorization: `Basic ${basicAuth}`
    },
    body: toString(car.body, 'base64')
  })

  // Handles invocation
  await t.notThrowsAsync(() => processInvocationsCar(request, {
    storeBucket,
    basicAuth,
    streamName,
    kinesisClient: {
      // @ts-expect-error not same return type
      putRecords: (input) => {
        t.is(input.StreamName, streamName)
        t.is(input.Records?.length, decodedCar.roots.length)

        for (const record of input.Records || []) {
          if (!record.Data) {
            throw new Error('must have Data')
          }
          const invocation = JSON.parse(toString(record.Data))
          t.truthy(invocation)
        }
        return Promise.resolve()
      }
    }
  }))

  // Verify invocation persisted
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

  await t.throwsAsync(() => processInvocationsCar(request, {
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

  await t.throwsAsync(() => processInvocationsCar(request, {
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

  await t.throwsAsync(() => processInvocationsCar(request, {
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

  await t.throwsAsync(() => processInvocationsCar(request, {
    storeBucket,
    basicAuth
  }))
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

/**
 * @param {import('@ucanto/interface').Ability} can
 * @param {any} nb
 */
async function createUcanInvocation (can, nb) {
  const uploadService = await Signer.generate()
  const alice = await Signer.generate()
  const { proof, spaceDid } = await createSpace(alice)
  
  return await ucanto.delegate({
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
  })
}
