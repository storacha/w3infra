import { s3 as test } from './helpers/context.js'

import { GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3'
import * as Signer from '@ucanto/principal/ed25519'
import * as CAR from '@ucanto/transport/car'
import * as CBOR from '@ucanto/transport/cbor'
import * as UCAN from '@ipld/dag-ucan'
import { add as storeAdd } from '@web3-storage/capabilities/store'
import { add as uploadAdd } from '@web3-storage/capabilities/upload'
import { toString } from 'uint8arrays/to-string'
import { equals } from 'uint8arrays/equals'
// @ts-expect-error
import lambdaUtils from 'aws-lambda-test-utils'

import { createS3, createBucket } from './helpers/resources.js'
import { randomCAR } from './helpers/random.js'
import {
  createSpace,
  createReceipt,
  createUcanInvocation
} from './helpers/ucan.js'

import { useUcanStore } from '../buckets/ucan-store.js'
import {
  processUcanLogRequest,
  parseWorkflow,
  persistWorkflow,
  parseReceiptCbor,
  persistReceipt,
  replaceAllLinkValues,
  CONTENT_TYPE
} from '../ucan-invocation.js'


test.before(async (t) => {
  const { client: s3 } = await createS3({
    port: 9000,
  })

  t.context.s3 = s3
})

test('parses Workflow as CAR with ucan invocations', async (t) => {
  const uploadService = await Signer.generate()
  const alice = await Signer.generate()
  const { proof, spaceDid } = await createSpace(alice)

  const data = new Uint8Array([11, 22, 34, 44, 55])
  const link = await CAR.codec.link(data)
  const nb = { link, size: data.byteLength }
  const can = 'store/add'

  const workflowRequest = await CAR.encode([
    await createUcanInvocation(can, nb, {
      issuer: alice,
      audience: uploadService,
      withDid: spaceDid,
      proofs: [proof]
    })
  ])

  const workflow = await parseWorkflow(workflowRequest.body)
  const requestCar = await CAR.codec.decode(workflowRequest.body)
  const requestCarRootCid = requestCar.roots[0].cid

  t.is(workflow.cid.toString(), requestCarRootCid.toString())
  t.truthy(workflow.bytes)
  
  // Decode and validate bytes
  const workflowCar = await CAR.codec.decode(workflow.bytes)
  // @ts-expect-error UCAN.View<UCAN.Capabilities> inferred as UCAN.View<unknown>
  const invocation = UCAN.decode(workflowCar.roots[0].bytes)

  t.is(invocation.iss.did(), alice.did())
  t.is(invocation.aud.did(), uploadService.did())
  t.deepEqual(invocation.prf, [proof.root.cid])
  t.is(invocation.att.length, 1)
  t.like(invocation.att[0], {
    nb,
    can,
    with: spaceDid,
  })
})

test('persists workflow with invocations as CAR file', async (t) => {
  const { bucketName } = await prepareResources(t.context.s3)
  const ucanStore = useUcanStore(t.context.s3, bucketName)

  const uploadService = await Signer.generate()
  const alice = await Signer.generate()

  const data = new Uint8Array([11, 22, 34, 44, 55])
  const link = await CAR.codec.link(data)
  const nb = { link, size: data.byteLength }
  const can = 'store/add'

  const workflowRequest = await CAR.encode([
    await createUcanInvocation(can, nb, {
      issuer: alice,
      audience: uploadService
    })
  ])

  const workflow = await parseWorkflow(workflowRequest.body)
  await persistWorkflow(workflow, ucanStore)

  const requestCar = await CAR.codec.decode(workflowRequest.body)
  const workflowCid = requestCar.roots[0].cid.toString()
  const invocationCid = workflowCid

  // Verify invocation mapping within workflow stored
  const cmdInvocationStored = new HeadObjectCommand({
    Key: `invocation/${invocationCid}/${workflowCid}.workflow`,
    Bucket: bucketName,
  })
  const s3ResponseInvocationStored = await t.context.s3.send(cmdInvocationStored)
  t.is(s3ResponseInvocationStored.$metadata.httpStatusCode, 200)

  // Verify Workflow stored
  const cmdCarStored = new GetObjectCommand({
    Key: `workflow/${workflowCid}`,
    Bucket: bucketName,
  })
  const s3ResponseCarStored = await t.context.s3.send(cmdCarStored)
  t.is(s3ResponseCarStored.$metadata.httpStatusCode, 200)

  // @ts-expect-error AWS types with readable stream
  const bytes = (await s3ResponseCarStored.Body.toArray())[0]

  const workflowCar = await CAR.codec.decode(bytes)
  const workflowCarRootCid = workflowCar.roots[0].cid.toString()

  t.is(workflowCid, workflowCarRootCid)
  // @ts-expect-error unkown ByteView type
  const invocation = UCAN.decode(workflowCar.roots[0].bytes)

  t.is(invocation.iss.did(), alice.did())
  t.is(invocation.aud.did(), uploadService.did())
  t.is(invocation.att.length, 1)
  t.like(invocation.att[0], {
    nb,
    can,
  })
})

test('parses a receipt cbor', async (t) => {
  const uploadService = await Signer.generate()

  const data = new Uint8Array([11, 22, 34, 44, 55])
  const link = await CAR.codec.link(data)
  const nb = { link, size: data.byteLength }
  const can = 'store/add'

  // Create workflow request
  const workflowRequest = await CAR.encode([
    await createUcanInvocation(can, nb, {
      audience: uploadService
    })
  ])

  const requestCar = await CAR.codec.decode(workflowRequest.body)
  const invocationCid = requestCar.roots[0].cid

  // Create receipt
  const out = {
    ok: 'Done'
  }
  const receipt = await CBOR.codec.write({
    ran: invocationCid,
    out,
    fx: { fork: [] },
    meta: {},
    iss: uploadService.signer.did(),
    prf: [],
  })
  
  // Validate receipt
  const { bytes, cid, data: parsedData } = await parseReceiptCbor(receipt.bytes)
  t.truthy(bytes)
  // @ts-expect-error cid unknown or cid from receipt
  t.is(receipt.cid.toString(), cid.toString())
  t.is(parsedData.ran.toString(), invocationCid.toString())
  t.deepEqual(parsedData.out, out)
})

test('persists receipt and its associated data', async t => {
  const { bucketName } = await prepareResources(t.context.s3)
  const ucanStore = useUcanStore(t.context.s3, bucketName)
  const uploadService = await Signer.generate()

  const data = new Uint8Array([11, 22, 34, 44, 55])
  const link = await CAR.codec.link(data)
  const nb = { link, size: data.byteLength }
  const can = 'store/add'

  // Create workflow request
  const workflowRequest = await CAR.encode([
    await createUcanInvocation(can, nb, {
      audience: uploadService
    })
  ])

  const requestCar = await CAR.codec.decode(workflowRequest.body)
  const invocationCid = requestCar.roots[0].cid
  // TODO: For now we will use delegation CID as both invocation and task CID
  // Delegation CIDs are the roots in the received CAR and CID in the .ran field
  // of the received receipt.
  const taskCid = invocationCid

  // Create receipt
  const out = {
    ok: 'Done'
  }
  const receipt = await CBOR.codec.write({
    ran: invocationCid,
    out,
    fx: { fork: [] },
    meta: {},
    iss: uploadService.signer.did(),
    prf: [],
  })
  
  // Persist receipt
  const receiptBlock = await parseReceiptCbor(receipt.bytes)
  await persistReceipt(receiptBlock, ucanStore)

  // Validate invocation receipt block
  const cmdReceiptBlock = new GetObjectCommand({
    Key: `invocation/${invocationCid}.receipt`,
    Bucket: bucketName,
  })
  const s3ResponseReceiptBlock = await t.context.s3.send(cmdReceiptBlock)
  t.is(s3ResponseReceiptBlock.$metadata.httpStatusCode, 200)

  // @ts-expect-error AWS types with readable stream
  const s3ReceiptBlockBytes = (await s3ResponseReceiptBlock.Body.toArray())[0]
  t.truthy(equals(s3ReceiptBlockBytes, receiptBlock.bytes))

  // Validate stored task result
  const cmdTaskResult = new GetObjectCommand({
    Key: `task/${taskCid}.result`,
    Bucket: bucketName,
  })
  const s3ResponseTaskResult = await t.context.s3.send(cmdTaskResult)
  t.is(s3ResponseTaskResult.$metadata.httpStatusCode, 200)

  // @ts-expect-error AWS types with readable stream
  const s3TaskResultBytes = (await s3ResponseTaskResult.Body.toArray())[0]
  const taskResult = await CBOR.codec.write({
    out
  })
  t.truthy(equals(s3TaskResultBytes, taskResult.bytes))
  
  // Validate task index within invocation stored
  const cmdTaskIndexStored = new HeadObjectCommand({
    Key: `task/${taskCid}/${invocationCid}.invocation`,
    Bucket: bucketName,
  })
  const s3ResponseTaskIndexStored = await t.context.s3.send(cmdTaskIndexStored)
  t.is(s3ResponseTaskIndexStored.$metadata.httpStatusCode, 200)
})

test('can process a ucan log request for a workflow CAR with one invocation', async t => {
  t.plan(7)
  const { bucketName } = await prepareResources(t.context.s3)
  const basicAuth = 'test-token'
  const streamName = 'stream-name'
  const storeBucket = useUcanStore(t.context.s3, bucketName)

  // Create workflow with one UCAN invocation
  const data = new Uint8Array([11, 22, 34, 44, 55])
  const link = await CAR.codec.link(data)

  const workflow = await CAR.encode([
    await createUcanInvocation(
      storeAdd.can,
      { link, size: data.byteLength }
    )
  ])
  const decodedWorkflowCar = await CAR.codec.decode(workflow.body)

  // Create Workflow request with car
  const workflowRequest = lambdaUtils.mockEventCreator.createAPIGatewayEvent({
    headers: {
      Authorization: `Basic ${basicAuth}`,
      'Content-Type': CONTENT_TYPE.WORKFLOW
    },
    body: toString(workflow.body, 'base64')
  })

  // Handles invocation
  await t.notThrowsAsync(() => processUcanLogRequest(workflowRequest, {
    storeBucket,
    basicAuth,
    streamName,
    kinesisClient: {
      // @ts-expect-error not same return type
      putRecords: (input) => {
        t.is(input.StreamName, streamName)
        t.is(input.Records?.length, decodedWorkflowCar.roots.length)
        for (const record of input.Records || []) {
          if (!record.Data) {
            throw new Error('must have Data')
          }
          const invocation = JSON.parse(toString(record.Data))
          t.truthy(invocation)
          t.is(invocation.type, CONTENT_TYPE.WORKFLOW)
        }
        return Promise.resolve()
      }
    }
  }))

  // Verify workflow persisted
  const workflowCid = decodedWorkflowCar.roots[0].cid.toString()
  const invocationCid = workflowCid
  const cmd = new HeadObjectCommand({
    Key: `workflow/${workflowCid}`,
    Bucket: bucketName,
  })
  const s3Response = await t.context.s3.send(cmd)
  t.is(s3Response.$metadata.httpStatusCode, 200)

  // Verify invocation mapping within workflow stored
  const cmdInvocationStored = new HeadObjectCommand({
    Key: `invocation/${invocationCid}/${workflowCid}.workflow`,
    Bucket: bucketName,
  })
  const s3ResponseInvocationStored = await t.context.s3.send(cmdInvocationStored)
  t.is(s3ResponseInvocationStored.$metadata.httpStatusCode, 200)
})

test('can process a ucan log request for a workflow CAR with multiple invocations', async t => {
  t.plan(10)
  const { bucketName } = await prepareResources(t.context.s3)
  const basicAuth = 'test-token'
  const streamName = 'stream-name'
  const storeBucket = useUcanStore(t.context.s3, bucketName)

  // Create workflow with multiple UCAN invocation
  const data = new Uint8Array([11, 22, 34, 44, 55])
  const link = await CAR.codec.link(data)
  const workflow = await CAR.encode([
    await createUcanInvocation(
      storeAdd.can,
      { link, size: data.byteLength }
    ),
    await createUcanInvocation(
      uploadAdd.can,
      { root: link }
    )
  ])
  const decodedWorkflowCar = await CAR.codec.decode(workflow.body)

  // Create Workflow request with car
  const workflowRequest = lambdaUtils.mockEventCreator.createAPIGatewayEvent({
    headers: {
      Authorization: `Basic ${basicAuth}`,
      'Content-Type': CONTENT_TYPE.WORKFLOW
    },
    body: toString(workflow.body, 'base64')
  })

  // Handles invocation
  await t.notThrowsAsync(() => processUcanLogRequest(workflowRequest, {
    storeBucket,
    basicAuth,
    streamName,
    kinesisClient: {
      // @ts-expect-error not same return type
      putRecords: (input) => {
        t.is(input.StreamName, streamName)
        t.is(input.Records?.length, decodedWorkflowCar.roots.length)

        for (const record of input.Records || []) {
          if (!record.Data) {
            throw new Error('must have Data')
          }
          const invocation = JSON.parse(toString(record.Data))
          t.truthy(invocation)
          t.is(invocation.type, CONTENT_TYPE.WORKFLOW)
        }
        return Promise.resolve()
      }
    }
  }))

  // Verify workflow persisted
  const workflowCid = decodedWorkflowCar.roots[0].cid.toString()
  const cmd = new HeadObjectCommand({
    Key: `workflow/${workflowCid}`,
    Bucket: bucketName,
  })
  const s3Response = await t.context.s3.send(cmd)
  t.is(s3Response.$metadata.httpStatusCode, 200)

  // Verify all invocations persisted
  for (const root of decodedWorkflowCar.roots) {
    const invocationCid = root.cid.toString()
    // Verify invocation mapping within workflow stored
    const cmdInvocationStored = new HeadObjectCommand({
      Key: `invocation/${invocationCid}/${workflowCid}.workflow`,
      Bucket: bucketName,
    })
    const s3ResponseInvocationStored = await t.context.s3.send(cmdInvocationStored)
    t.is(s3ResponseInvocationStored.$metadata.httpStatusCode, 200)
  }
})

test('can process ucan log request for given receipt after its invocation stored', async t => {
  const { bucketName } = await prepareResources(t.context.s3)
  const basicAuth = 'test-token'
  const streamName = 'stream-name'
  const storeBucket = useUcanStore(t.context.s3, bucketName)
  const uploadService = await Signer.generate()

  // Create workflow with one UCAN invocation
  const data = new Uint8Array([11, 22, 34, 44, 55])
  const link = await CAR.codec.link(data)
  const workflow = await CAR.encode([
    await createUcanInvocation(
      storeAdd.can,
      { link, size: data.byteLength }
    )
  ])
  const requestCar = await CAR.codec.decode(workflow.body)
  const requestCarRootCid = requestCar.roots[0].cid

  // Create Workflow request with car
  const workflowRequest = lambdaUtils.mockEventCreator.createAPIGatewayEvent({
    headers: {
      Authorization: `Basic ${basicAuth}`,
      'Content-Type': CONTENT_TYPE.WORKFLOW
    },
    body: toString(workflow.body, 'base64')
  })

  // process ucan log request for workflow
  /** @type {any[]} */
  const kinesisWorkflowInvocations = []
  await t.notThrowsAsync(() => processUcanLogRequest(workflowRequest, {
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
          kinesisWorkflowInvocations?.push(JSON.parse(toString(record.Data)))
        }
        return Promise.resolve()
      }
    }
  }))

  // create receipt
  const receipt = await createReceipt(
    requestCarRootCid,
    { ok: 'Done' },
    uploadService.signer
  )

  // Create receipt request with cbor
  const { bytes: receiptBytes, cid: receiptCid } = await CBOR.codec.write(receipt)
  const receiptRequest = lambdaUtils.mockEventCreator.createAPIGatewayEvent({
    headers: {
      Authorization: `Basic ${basicAuth}`,
      'Content-Type': CONTENT_TYPE.RECEIPT
    },
    body: toString(receiptBytes, 'base64')
  })

  // process ucan log request for receipt
  await t.notThrowsAsync(() => processUcanLogRequest(receiptRequest, {
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
        t.deepEqual(data.value, kinesisWorkflowInvocations[0].value)
        return Promise.resolve()
      }
    }
  }))

  // Verify persisted
  // const workflowCid = decodedWorkflowCar.roots[0].cid.toString()
  // const cmd = new HeadObjectCommand({
  //   Key: `workflow/${workflowCid}`,
  //   Bucket: bucketName,
  // })
  // const s3Response = await t.context.s3.send(cmd)
  // t.is(s3Response.$metadata.httpStatusCode, 200)
})

test('fails to process ucan log request for given receipt when no associated invocation is stored', async t => {
  const { bucketName } = await prepareResources(t.context.s3)
  const basicAuth = 'test-token'
  const streamName = 'stream-name'
  const storeBucket = useUcanStore(t.context.s3, bucketName)
  const uploadService = await Signer.generate()

  // Create workflow with one UCAN invocation
  const data = new Uint8Array([11, 22, 34, 44, 55])
  const link = await CAR.codec.link(data)
  const workflow = await CAR.encode([
    await createUcanInvocation(
      storeAdd.can,
      { link, size: data.byteLength }
    )
  ])
  const requestCar = await CAR.codec.decode(workflow.body)
  const requestCarRootCid = requestCar.roots[0].cid

  // create receipt
  const receipt = await createReceipt(
    requestCarRootCid,
    { ok: 'Done' },
    uploadService.signer
  )

  // Create receipt request with cbor
  const { bytes: receiptBytes } = await CBOR.codec.write(receipt)
  const requestReceipt = lambdaUtils.mockEventCreator.createAPIGatewayEvent({
    headers: {
      Authorization: `Basic ${basicAuth}`,
      'Content-Type': CONTENT_TYPE.RECEIPT
    },
    body: toString(receiptBytes, 'base64')
  })

  // Fails handling receipt request given no invocation for it is stored
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
