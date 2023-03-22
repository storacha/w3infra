import { s3 as test } from './helpers/context.js'

import { GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3'
import * as Signer from '@ucanto/principal/ed25519'
import * as CAR from '@ucanto/transport/car'
import * as CBOR from '@ucanto/transport/cbor'
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
  processUcanLogRequest,
  parseInvocationsCar,
  persistInvocationsCar,
  parseReceiptCbor,
  replaceAllLinkValues,
  CONTENT_TYPE
} from '../ucan-invocation.js'


test.before(async (t) => {
  const { client: s3 } = await createS3({
    port: 9000,
  })

  t.context.s3 = s3
})

test('parses CAR with ucan invocations', async (t) => {
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

  const ucanInvocationObject = await parseInvocationsCar(request.body)
  const requestCar = await CAR.codec.decode(request.body)
  const requestCarRootCid = requestCar.roots[0].cid

  t.is(ucanInvocationObject.cid.toString(), requestCarRootCid.toString())
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

  const invocationsCar = await parseInvocationsCar(request.body)
  await persistInvocationsCar(invocationsCar, ucanStore)

  const requestCar = await CAR.codec.decode(request.body)
  const requestCarRootCid = requestCar.roots[0].cid.toString()

  // Verify invocation stored
  const cmdInvocationStored = new HeadObjectCommand({
    Key: `${requestCarRootCid}/${requestCarRootCid}.invocation`,
    Bucket: bucketName,
  })
  const s3ResponseInvocationStored = await t.context.s3.send(cmdInvocationStored)
  t.is(s3ResponseInvocationStored.$metadata.httpStatusCode, 200)

  // Verify CAR stored
  const cmdCarStored = new GetObjectCommand({
    Key: `${requestCarRootCid}/${requestCarRootCid}.car`,
    Bucket: bucketName,
  })
  const s3ResponseCarStored = await t.context.s3.send(cmdCarStored)
  t.is(s3ResponseCarStored.$metadata.httpStatusCode, 200)

  // @ts-expect-error AWS types with readable stream
  const bytes = (await s3ResponseCarStored.Body.toArray())[0]

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

test('parses receipt cbor', async (t) => {
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

  const requestCar = await CAR.codec.decode(request.body)
  const requestCarRootCid = requestCar.roots[0].cid
  const out = {
    ok: 'Done'
  }

  const receipt = await CBOR.codec.write({
    ran: requestCarRootCid,
    out,
    fx: { fork: [] },
    meta: {},
    iss: uploadService.signer.did(),
    prf: [],
  })
  
  const { bytes, cid, data: parsedData } = await parseReceiptCbor(
    receipt.bytes
  )

  t.truthy(bytes)
  // @ts-expect-error cid unknown or cid from receipt
  t.is(receipt.cid.toString(), cid.toString())
  t.is(parsedData.ran.toString(), requestCarRootCid.toString())
  t.deepEqual(parsedData.out, out)
})

test('can process a ucan log request for given CAR with one ucan invocation', async t => {
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
    )
  ])
  const decodedCar = await CAR.codec.decode(car.body)
  const request = lambdaUtils.mockEventCreator.createAPIGatewayEvent({
    headers: {
      Authorization: `Basic ${basicAuth}`,
      'Content-Type': CONTENT_TYPE.INVOCATIONS
    },
    body: toString(car.body, 'base64')
  })

  // Handles invocation
  await t.notThrowsAsync(() => processUcanLogRequest(request, {
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
          t.is(invocation.type, CONTENT_TYPE.INVOCATIONS)
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

test('can process a ucan log request for given CAR with multiple ucan invocations', async t => {
  t.plan(8)
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
      Authorization: `Basic ${basicAuth}`,
      'Content-Type': CONTENT_TYPE.INVOCATIONS
    },
    body: toString(car.body, 'base64')
  })

  // Handles invocation
  await t.notThrowsAsync(() => processUcanLogRequest(request, {
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
          t.is(invocation.type, CONTENT_TYPE.INVOCATIONS)
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

test('can proces ucan log request for given receipt after invocation stored', async t => {
  const { bucketName } = await prepareResources(t.context.s3)
  const basicAuth = 'test-token'
  const streamName = 'stream-name'
  const storeBucket = useUcanStore(t.context.s3, bucketName)

  const uploadService = await Signer.generate()
  // Create CAR with one UCAN invocation
  const data = new Uint8Array([11, 22, 34, 44, 55])
  const link = await CAR.codec.link(data)

  const car = await CAR.encode([
    await createUcanInvocation(
      storeAdd.can,
      { link, size: data.byteLength }
    )
  ])
  const requestCarInvocations = lambdaUtils.mockEventCreator.createAPIGatewayEvent({
    headers: {
      Authorization: `Basic ${basicAuth}`,
      'Content-Type': CONTENT_TYPE.INVOCATIONS
    },
    body: toString(car.body, 'base64')
  })

  /**
   * @type {any[]}
   */
  const kinesisInvocationRecords = []
  // Handles ucan log request for CAR
  await t.notThrowsAsync(() => processUcanLogRequest(requestCarInvocations, {
    storeBucket,
    basicAuth,
    streamName,
    kinesisClient: {
      // @ts-expect-error not same return type
      putRecords: (input) => {
        for (const record of input.Records || []) {
          if (!record.Data) {
            throw new Error('must have Data')
          }
          kinesisInvocationRecords?.push(JSON.parse(toString(record.Data)))
        }
        return Promise.resolve()
      }
    }
  }))

  const requestCar = await CAR.codec.decode(car.body)
  const requestCarRootCid = requestCar.roots[0].cid
  const out = {
    ok: 'Done'
  }

  const receiptPayload = {
    ran: requestCarRootCid,
    out,
    fx: { fork: [] },
    meta: {},
    iss: uploadService.signer.did(),
    prf: [],
  }
  const receipt = {
    ...receiptPayload,
    s: await uploadService.signer.sign(CBOR.codec.encode(receiptPayload))
  }

  const { bytes: receiptBytes, cid: receiptCid } = await CBOR.codec.write(receipt)
  const requestReceipt = lambdaUtils.mockEventCreator.createAPIGatewayEvent({
    headers: {
      Authorization: `Basic ${basicAuth}`,
      'Content-Type': CONTENT_TYPE.RECEIPT
    },
    body: toString(receiptBytes, 'base64')
  })

  // Handles ucan log request for receipt
  await t.notThrowsAsync(() => processUcanLogRequest(requestReceipt, {
    storeBucket,
    basicAuth,
    streamName,
    kinesisClient: {
      // @ts-expect-error not same return type
      putRecord: (input) => {
        t.is(input.StreamName, streamName)
        if (!input.Data) {
          throw new Error('must have Data')
        }
        const data = JSON.parse(toString(input.Data))
        t.truthy(data)
        t.is(data.carCid, requestCarRootCid.toString())
        t.is(data.invocationCid, receiptCid.toString())
        t.is(data.type, CONTENT_TYPE.RECEIPT)
        t.deepEqual(data.value, kinesisInvocationRecords[0].value)
        return Promise.resolve()
      }
    }
  }))
})

test('fails to process ucan log request for given receipt when no invocation stored', async t => {
  const { bucketName } = await prepareResources(t.context.s3)
  const basicAuth = 'test-token'
  const streamName = 'stream-name'
  const storeBucket = useUcanStore(t.context.s3, bucketName)

  const uploadService = await Signer.generate()
  // Create CAR with one UCAN invocation
  const data = new Uint8Array([11, 22, 34, 44, 55])
  const link = await CAR.codec.link(data)

  const car = await CAR.encode([
    await createUcanInvocation(
      storeAdd.can,
      { link, size: data.byteLength }
    )
  ])

  const requestCar = await CAR.codec.decode(car.body)
  const requestCarRootCid = requestCar.roots[0].cid
  const out = {
    ok: 'Done'
  }

  const receiptPayload = {
    ran: requestCarRootCid,
    out,
    fx: { fork: [] },
    meta: {},
    iss: uploadService.signer.did(),
    prf: [],
  }
  const receipt = {
    ...receiptPayload,
    s: await uploadService.signer.sign(CBOR.codec.encode(receiptPayload))
  }

  const { bytes: receiptBytes } = await CBOR.codec.write(receipt)
  const requestReceipt = lambdaUtils.mockEventCreator.createAPIGatewayEvent({
    headers: {
      Authorization: `Basic ${basicAuth}`,
      'Content-Type': CONTENT_TYPE.RECEIPT
    },
    body: toString(receiptBytes, 'base64')
  })

  // Fails handling receipt request given no invocation is stored
  await t.throwsAsync(() => processUcanLogRequest(requestReceipt, {
    storeBucket,
    basicAuth,
    streamName,
    kinesisClient: {
      // @ts-expect-error not same return type
      putRecord: () => {
        return Promise.resolve()
      }
    }
  }))
})

test('fails to process ucan log request with unknown content type', async t => {
  const { bucketName } = await prepareResources(t.context.s3)
  const basicAuth = 'test-token'
  const storeBucket = useUcanStore(t.context.s3, bucketName)
  const request = lambdaUtils.mockEventCreator.createAPIGatewayEvent({
    headers: {
      Authorization: `Basic ${basicAuth}`,
      'Content-Type': 'unknown'
    }
  })

  await t.throwsAsync(() => processUcanLogRequest(request, {
    storeBucket,
    streamName: 'name',
    basicAuth
  }))
})

test('fails to process ucan log request with no Authorization header', async t => {
  const { bucketName } = await prepareResources(t.context.s3)
  const basicAuth = 'test-token'
  const storeBucket = useUcanStore(t.context.s3, bucketName)
  const request = lambdaUtils.mockEventCreator.createAPIGatewayEvent()

  await t.throwsAsync(() => processUcanLogRequest(request, {
    storeBucket,
    streamName: 'name',
    basicAuth
  }))
})

test('fails to process ucan log request with no Authorization basic header', async t => {
  const { bucketName } = await prepareResources(t.context.s3)
  const basicAuth = 'test-token'
  const storeBucket = useUcanStore(t.context.s3, bucketName)
  const request = lambdaUtils.mockEventCreator.createAPIGatewayEvent({
    headers: {
      Authorization: 'Bearer token-test'
    }
  })

  await t.throwsAsync(() => processUcanLogRequest(request, {
    storeBucket,
    streamName: 'name',
    basicAuth
  }))
})

test('fails to process ucan log request with Authorization basic token empty', async t => {
  const { bucketName } = await prepareResources(t.context.s3)
  const basicAuth = 'test-token'
  const storeBucket = useUcanStore(t.context.s3, bucketName)
  const request = lambdaUtils.mockEventCreator.createAPIGatewayEvent({
    headers: {
      Authorization: 'Basic'
    }
  })

  await t.throwsAsync(() => processUcanLogRequest(request, {
    storeBucket,
    streamName: 'name',
    basicAuth
  }))
})

test('fails to process ucan log request with invalid Authorization basic token', async t => {
  const { bucketName } = await prepareResources(t.context.s3)
  const basicAuth = 'test-token'
  const storeBucket = useUcanStore(t.context.s3, bucketName)
  const request = lambdaUtils.mockEventCreator.createAPIGatewayEvent({
    headers: {
      Authorization: 'Basic invalid-token'
    }
  })

  await t.throwsAsync(() => processUcanLogRequest(request, {
    storeBucket,
    streamName: 'name',
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
