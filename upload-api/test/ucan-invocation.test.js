import { s3 as test } from './helpers/context.js'

import { GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3'
import * as Signer from '@ucanto/principal/ed25519'
import { Message } from '@ucanto/core-next'
import * as CAR from '@ucanto/transport/car'
import * as CAR_LEGACY from '@ucanto/transport-legacy/car'
import * as CBOR_LEGACY from '@ucanto/transport-legacy/cbor'
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
  createUcanInvocation,
  createAgentMessageInvocation,
  createAgentMessageReceipt
} from './helpers/ucan.js'

import { useInvocationStore } from '../buckets/invocation-store.js'
import { useTaskStore } from '../buckets/task-store.js'
import { useWorkflowStore } from '../buckets/workflow-store.js'
import {
  processUcanLogRequest,
  parseWorkflow,
  persistWorkflow,
  parseReceiptCbor,
  persistReceipt,
  replaceAllLinkValues,
  CONTENT_TYPE,
  STREAM_TYPE
} from '../ucan-invocation.js'


test.before(async (t) => {
  const { client: s3 } = await createS3({
    port: 9000,
  })

  t.context.s3 = s3
})

test('processes agent message as CAR with multiple invocations', async t => {
  t.plan(18)
  const stores = await getStores(t.context)
  const basicAuth = 'test-token'
  const streamName = 'stream-name'

  // Create agent message with two invocations
  const uploadService = await Signer.generate()
  const alice = await Signer.generate()
  const { proof, spaceDid } = await createSpace(alice)

  const data = new Uint8Array([11, 22, 34, 44, 55])
  const link = await CAR_LEGACY.codec.link(data)

  const capabilities = [
    {
      can: storeAdd.can,
      nb: { link, size: data.byteLength }
    },
    {
      can: uploadAdd.can,
      nb: { root: link }
    }
  ]

  const invocations = await Promise.all(capabilities.map(cap => 
    createAgentMessageInvocation(cap.can, cap.nb, {
      issuer: alice,
      audience: uploadService,
      withDid: spaceDid,
      proofs: [proof]
    })
  ))

  // @ts-ignore type incompat?
  const message = await Message.build({ invocations })
  const car = CAR.request.encode(message)

   // Create request with car
   const carRequest = lambdaUtils.mockEventCreator.createAPIGatewayEvent({
    headers: {
      authorization: `Basic ${basicAuth}`,
      'content-type': car.headers['content-type']
    },
    body: toString(car.body, 'base64')
  })

  // Decode request for expectations
  const decodedCar = await CAR.codec.decode(new Uint8Array(car.body.buffer))
  const agentMessageCarCid = decodedCar.roots[0].cid.toString()
  const agentMessage = await CAR.request.decode(car)
  
  await t.notThrowsAsync(() => processUcanLogRequest(carRequest, {
    invocationBucket: stores.invocation.bucket,
    taskBucket: stores.task.bucket,
    workflowBucket: stores.workflow.bucket,
    basicAuth,
    streamName,
    kinesisClient: {
      // @ts-expect-error not same return type
      putRecords: (input) => {
        t.is(input.StreamName, streamName)
        t.is(input.Records?.length, invocations.length)
        for (const record of input.Records || []) {
          if (!record.Data) {
            throw new Error('must have Data')
          }
          const invocation = JSON.parse(toString(record.Data))
          t.truthy(invocation)
          t.truthy(invocation.ts)
          t.is(invocation.type, STREAM_TYPE.WORKFLOW)
          t.is(invocation.carCid, agentMessageCarCid)

          const cap = capabilities.find(cap => cap.can === invocation.value.att[0].can)
          t.truthy(cap)
          t.deepEqual(replaceAllLinkValues(cap?.nb), invocation.value.att[0].nb)
        }

        return Promise.resolve()
      }
    }
  }))

  // Minio might take a bit
  await new Promise((resolve) => setTimeout(() => resolve(true), 100))

  // Verify CAR agent message persisted
  const cmd = new HeadObjectCommand({
    Key: `${agentMessageCarCid}/${agentMessageCarCid}`,
    Bucket: stores.workflow.name,
  })
  const s3Response = await t.context.s3.send(cmd)
  t.is(s3Response.$metadata.httpStatusCode, 200)

  // Verify invocation symlink for car agent message stored
  for (const invocation of agentMessage.invocations) {
    const cmdInvocationStored = new HeadObjectCommand({
      Key: `${invocation.cid.toString()}/${agentMessageCarCid}.in`,
      Bucket: stores.invocation.name,
    })
    const s3ResponseInvocationStored = await t.context.s3.send(cmdInvocationStored)
    t.is(s3ResponseInvocationStored.$metadata.httpStatusCode, 200)
  }
})

test('processes agent message as CAR with receipt', async t => {
  t.plan(15)
  const stores = await getStores(t.context)
  const basicAuth = 'test-token'
  const streamName = 'stream-name'

  const uploadService = await Signer.generate()
  const alice = await Signer.generate()
  const { proof, spaceDid } = await createSpace(alice)

  // Create message with one UCAN invocation
  const data = new Uint8Array([11, 22, 34, 44, 55])
  const link = await CAR_LEGACY.codec.link(data)

  const capabilities = [
    {
      can: storeAdd.can,
      nb: { link, size: data.byteLength }
    },
  ]

  const invocations = await Promise.all(capabilities.map(cap => 
    createAgentMessageInvocation(cap.can, cap.nb, {
      issuer: alice,
      audience: uploadService,
      withDid: spaceDid,
      proofs: [proof]
    })
  ))

  // @ts-ignore type incompat?
  const messageInvocations = await Message.build({ invocations })
  const carInvocations = CAR.request.encode(messageInvocations)

  // Create request with car
  const carInvocationsRequest = lambdaUtils.mockEventCreator.createAPIGatewayEvent({
    headers: {
      authorization: `Basic ${basicAuth}`,
      'content-type': carInvocations.headers['content-type']
    },
    body: toString(carInvocations.body, 'base64')
  })

  // process ucan log request for message
  /** @type {any[]} */
  const kinesisWorkflowInvocations = []
  await t.notThrowsAsync(() => processUcanLogRequest(carInvocationsRequest, {
    invocationBucket: stores.invocation.bucket,
    taskBucket: stores.task.bucket,
    workflowBucket: stores.workflow.bucket,
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

  // Create receipts
  const result = {
    ok: {
      deleted: true
    }
  }
  const receipts = await Promise.all(invocations.map(i => createAgentMessageReceipt(i, {
    result
  })))

  // @ts-ignore type incompat?
  const messageReceipts = await Message.build({ receipts })
  const carReceipts = CAR.request.encode(messageReceipts)

  // Decode request for expectations
  const decodedCarReceipts = await CAR.codec.decode(new Uint8Array(carReceipts.body.buffer))
  const agentMessageCarReceiptsCid = decodedCarReceipts.roots[0].cid.toString()
  const agentMessageReceipts = await CAR.request.decode(carReceipts)
  const invocationCid = [...agentMessageReceipts.receipts.values()][0].ran.link().toString()

  // Create request with car
  const carReceiptsRequest = lambdaUtils.mockEventCreator.createAPIGatewayEvent({
    headers: {
      authorization: `Basic ${basicAuth}`,
      'content-type': carReceipts.headers['content-type']
    },
    body: toString(carReceipts.body, 'base64')
  })

  // process ucan log request for message
  /** @type {any[]} */
  await t.notThrowsAsync(() => processUcanLogRequest(carReceiptsRequest, {
    invocationBucket: stores.invocation.bucket,
    taskBucket: stores.task.bucket,
    workflowBucket: stores.workflow.bucket,
    basicAuth,
    streamName,
    kinesisClient: {
      // @ts-expect-error not same return type
      putRecords: (input) => {
        t.is(input.StreamName, streamName)
        t.is(input.Records?.length, receipts.length)
        for (const record of input.Records || []) {
          if (!record.Data) {
            throw new Error('must have Data')
          }
          const data = JSON.parse(toString(record.Data))
          t.truthy(data)
          t.is(data.carCid, agentMessageCarReceiptsCid.toString())
          t.is(data.invocationCid, invocationCid)
          t.is(data.type, STREAM_TYPE.RECEIPT)
          t.deepEqual(data.out, result)
          t.deepEqual(data.value, kinesisWorkflowInvocations[0].value)
        }
        return Promise.resolve()
      }
    }
  }))

  // Verify CAR agent message persisted
  const cmd = new HeadObjectCommand({
    Key: `${agentMessageCarReceiptsCid}/${agentMessageCarReceiptsCid}`,
    Bucket: stores.workflow.name,
  })
  const s3Response = await t.context.s3.send(cmd)
  t.is(s3Response.$metadata.httpStatusCode, 200)

  // Verify receipts
  for (const receipt of agentMessageReceipts.receipts.values()) {
    const invocationCid = receipt.ran.link().toString()
    const taskCid = invocationCid

    // Verify receipt symlink for car agent message stored
    const cmdInvocationStored = new HeadObjectCommand({
      Key: `${invocationCid}/${agentMessageCarReceiptsCid}.out`,
      Bucket: stores.invocation.name,
    })
    const s3ResponseInvocationStored = await t.context.s3.send(cmdInvocationStored)
    t.is(s3ResponseInvocationStored.$metadata.httpStatusCode, 200)

    // Validate stored task result
    const cmdTaskResult = new GetObjectCommand({
      Key: `${taskCid}/${taskCid}.result`,
      Bucket: stores.task.name,
    })
    const s3ResponseTaskResult = await t.context.s3.send(cmdTaskResult)
    t.is(s3ResponseTaskResult.$metadata.httpStatusCode, 200)

    // @ts-expect-error AWS types with readable stream
    const s3TaskResultBytes = (await s3ResponseTaskResult.Body.toArray())[0]
    const taskResult = await CBOR_LEGACY.codec.write({ out: result })
    t.truthy(equals(s3TaskResultBytes, taskResult.bytes))

    // Validate task index within invocation stored
    const cmdTaskIndexStored = new HeadObjectCommand({
      Key: `${taskCid}/${invocationCid}.invocation`,
      Bucket: stores.task.name,
    })
    const s3ResponseTaskIndexStored = await t.context.s3.send(cmdTaskIndexStored)
    t.is(s3ResponseTaskIndexStored.$metadata.httpStatusCode, 200)
  }
})

test('fails to process agent message as CAR with receipt when there is no invocation', async t => {
  const stores = await getStores(t.context)
  const basicAuth = 'test-token'
  const streamName = 'stream-name'

  const uploadService = await Signer.generate()
  const alice = await Signer.generate()
  const { proof, spaceDid } = await createSpace(alice)

  // Create message with one UCAN invocation
  const data = new Uint8Array([11, 22, 34, 44, 55])
  const link = await CAR_LEGACY.codec.link(data)

  const capabilities = [
    {
      can: storeAdd.can,
      nb: { link, size: data.byteLength }
    },
  ]

  const invocations = await Promise.all(capabilities.map(cap => 
    createAgentMessageInvocation(cap.can, cap.nb, {
      issuer: alice,
      audience: uploadService,
      withDid: spaceDid,
      proofs: [proof]
    })
  ))

  // Create receipts
  const result = {
    ok: {
      deleted: true
    }
  }
  const receipts = await Promise.all(invocations.map(i => createAgentMessageReceipt(i, {
    result
  })))

  // @ts-ignore type incompat?
  const messageReceipts = await Message.build({ receipts })
  const carReceipts = CAR.request.encode(messageReceipts)

  // Create request with car
  const carReceiptsRequest = lambdaUtils.mockEventCreator.createAPIGatewayEvent({
    headers: {
      authorization: `Basic ${basicAuth}`,
      'content-type': carReceipts.headers['content-type']
    },
    body: toString(carReceipts.body, 'base64')
  })

  // fails to process ucan log request for message
  /** @type {any[]} */
  await t.throwsAsync(() => processUcanLogRequest(carReceiptsRequest, {
    invocationBucket: stores.invocation.bucket,
    taskBucket: stores.task.bucket,
    workflowBucket: stores.workflow.bucket,
    basicAuth,
    streamName,
    kinesisClient: {
      // @ts-expect-error not same return type
      putRecords: () => {
        return Promise.resolve()
      }
    }
  }))
})

test('parses Workflow as CAR with ucan invocations', async (t) => {
  const uploadService = await Signer.generate()
  const alice = await Signer.generate()
  const { proof, spaceDid } = await createSpace(alice)

  const data = new Uint8Array([11, 22, 34, 44, 55])
  const link = await CAR_LEGACY.codec.link(data)
  const nb = { link, size: data.byteLength }
  const can = 'store/add'

  const workflowRequest = await CAR_LEGACY.encode([
    await createUcanInvocation(can, nb, {
      issuer: alice,
      audience: uploadService,
      withDid: spaceDid,
      proofs: [proof]
    })
  ])

  const workflow = await parseWorkflow(workflowRequest.body)
  const requestCar = await CAR_LEGACY.codec.decode(workflowRequest.body)
  const requestCarRootCid = requestCar.roots[0].cid

  t.is(workflow.cid.toString(), requestCarRootCid.toString())
  t.truthy(workflow.bytes)
  
  // Decode and validate bytes
  const workflowCar = await CAR_LEGACY.codec.decode(workflow.bytes)
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
  const stores = await getStores(t.context)
  const uploadService = await Signer.generate()
  const alice = await Signer.generate()

  const data = new Uint8Array([11, 22, 34, 44, 55])
  const link = await CAR_LEGACY.codec.link(data)
  const nb = { link, size: data.byteLength }
  const can = 'store/add'

  const workflowRequest = await CAR_LEGACY.encode([
    await createUcanInvocation(can, nb, {
      issuer: alice,
      audience: uploadService
    })
  ])

  const workflow = await parseWorkflow(workflowRequest.body)
  await persistWorkflow(workflow, stores.invocation.bucket, stores.workflow.bucket)

  const requestCar = await CAR_LEGACY.codec.decode(workflowRequest.body)
  const workflowCid = requestCar.roots[0].cid.toString()
  const invocationCid = workflowCid

  // Verify invocation mapping within workflow stored
  const cmdInvocationStored = new HeadObjectCommand({
    Key: `${invocationCid}/${workflowCid}.workflow`,
    Bucket: stores.invocation.name,
  })
  const s3ResponseInvocationStored = await t.context.s3.send(cmdInvocationStored)
  t.is(s3ResponseInvocationStored.$metadata.httpStatusCode, 200)

  // Verify Workflow stored
  const cmdCarStored = new GetObjectCommand({
    Key: `${workflowCid}/${workflowCid}`,
    Bucket: stores.workflow.name,
  })
  const s3ResponseCarStored = await t.context.s3.send(cmdCarStored)
  t.is(s3ResponseCarStored.$metadata.httpStatusCode, 200)

  // @ts-expect-error AWS types with readable stream
  const bytes = (await s3ResponseCarStored.Body.toArray())[0]

  const workflowCar = await CAR_LEGACY.codec.decode(bytes)
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
  const link = await CAR_LEGACY.codec.link(data)
  const nb = { link, size: data.byteLength }
  const can = 'store/add'

  // Create workflow request
  const workflowRequest = await CAR_LEGACY.encode([
    await createUcanInvocation(can, nb, {
      audience: uploadService
    })
  ])

  const requestCar = await CAR_LEGACY.codec.decode(workflowRequest.body)
  const invocationCid = requestCar.roots[0].cid

  // Create receipt
  const out = {
    ok: 'Done'
  }
  const receipt = await CBOR_LEGACY.codec.write({
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
  const stores = await getStores(t.context)
  const uploadService = await Signer.generate()

  const data = new Uint8Array([11, 22, 34, 44, 55])
  const link = await CAR_LEGACY.codec.link(data)
  const nb = { link, size: data.byteLength }
  const can = 'store/add'

  // Create workflow request
  const workflowRequest = await CAR_LEGACY.encode([
    await createUcanInvocation(can, nb, {
      audience: uploadService
    })
  ])

  const requestCar = await CAR_LEGACY.codec.decode(workflowRequest.body)
  const invocationCid = requestCar.roots[0].cid
  // TODO: For now we will use delegation CID as both invocation and task CID
  // Delegation CIDs are the roots in the received CAR and CID in the .ran field
  // of the received receipt.
  const taskCid = invocationCid

  // Create receipt
  const out = {
    ok: 'Done'
  }
  const receipt = await CBOR_LEGACY.codec.write({
    ran: invocationCid,
    out,
    fx: { fork: [] },
    meta: {},
    iss: uploadService.signer.did(),
    prf: [],
  })
  
  // Persist receipt
  const receiptBlock = await parseReceiptCbor(receipt.bytes)
  await persistReceipt(receiptBlock, stores.invocation.bucket, stores.task.bucket)

  // Validate invocation receipt block
  const cmdReceiptBlock = new GetObjectCommand({
    Key: `${invocationCid}/${invocationCid}.receipt`,
    Bucket: stores.invocation.name,
  })
  const s3ResponseReceiptBlock = await t.context.s3.send(cmdReceiptBlock)
  t.is(s3ResponseReceiptBlock.$metadata.httpStatusCode, 200)

  // @ts-expect-error AWS types with readable stream
  const s3ReceiptBlockBytes = (await s3ResponseReceiptBlock.Body.toArray())[0]
  t.truthy(equals(s3ReceiptBlockBytes, receiptBlock.bytes))

  // Validate stored task result
  const cmdTaskResult = new GetObjectCommand({
    Key: `${taskCid}/${taskCid}.result`,
    Bucket: stores.task.name,
  })
  const s3ResponseTaskResult = await t.context.s3.send(cmdTaskResult)
  t.is(s3ResponseTaskResult.$metadata.httpStatusCode, 200)

  // @ts-expect-error AWS types with readable stream
  const s3TaskResultBytes = (await s3ResponseTaskResult.Body.toArray())[0]
  const taskResult = await CBOR_LEGACY.codec.write({
    out
  })
  t.truthy(equals(s3TaskResultBytes, taskResult.bytes))
  
  // Validate task index within invocation stored
  const cmdTaskIndexStored = new HeadObjectCommand({
    Key: `${taskCid}/${invocationCid}.invocation`,
    Bucket: stores.task.name,
  })
  const s3ResponseTaskIndexStored = await t.context.s3.send(cmdTaskIndexStored)
  t.is(s3ResponseTaskIndexStored.$metadata.httpStatusCode, 200)
})

test('can process a ucan log request for a workflow CAR with one invocation', async t => {
  t.plan(11)
  const stores = await getStores(t.context)
  const basicAuth = 'test-token'
  const streamName = 'stream-name'

  // Create workflow with one UCAN invocation
  const data = new Uint8Array([11, 22, 34, 44, 55])
  const link = await CAR_LEGACY.codec.link(data)
  const can = storeAdd.can
  const nb = { link, size: data.byteLength }

  const workflow = await CAR_LEGACY.encode([
    await createUcanInvocation(can, nb)
  ])
  const decodedWorkflowCar = await CAR_LEGACY.codec.decode(workflow.body)
  const workflowCid = decodedWorkflowCar.roots[0].cid.toString()

  // Create Workflow request with car
  const workflowRequest = lambdaUtils.mockEventCreator.createAPIGatewayEvent({
    headers: {
      authorization: `Basic ${basicAuth}`,
      'content-type': CONTENT_TYPE.WORKFLOW
    },
    body: toString(workflow.body, 'base64')
  })

  // Handles invocation
  await t.notThrowsAsync(() => processUcanLogRequest(workflowRequest, {
    invocationBucket: stores.invocation.bucket,
    taskBucket: stores.task.bucket,
    workflowBucket: stores.workflow.bucket,
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
          t.truthy(invocation.ts)
          t.is(invocation.type, STREAM_TYPE.WORKFLOW)
          t.is(invocation.carCid, workflowCid)
          t.is(invocation.value.att[0].can, can)
          t.deepEqual(invocation.value.att[0].nb, replaceAllLinkValues(nb))
        }
        return Promise.resolve()
      }
    }
  }))

  // Verify workflow persisted
  const invocationCid = workflowCid
  const cmd = new HeadObjectCommand({
    Key: `${workflowCid}/${workflowCid}`,
    Bucket: stores.workflow.name,
  })
  const s3Response = await t.context.s3.send(cmd)
  t.is(s3Response.$metadata.httpStatusCode, 200)

  // Verify invocation mapping within workflow stored
  const cmdInvocationStored = new HeadObjectCommand({
    Key: `${invocationCid}/${workflowCid}.workflow`,
    Bucket: stores.invocation.name,
  })
  const s3ResponseInvocationStored = await t.context.s3.send(cmdInvocationStored)
  t.is(s3ResponseInvocationStored.$metadata.httpStatusCode, 200)
})

test('can process a ucan log request for a workflow CAR with multiple invocations', async t => {
  t.plan(11)
  const stores = await getStores(t.context)
  const basicAuth = 'test-token'
  const streamName = 'stream-name'

  // Create workflow with multiple UCAN invocation
  const data = new Uint8Array([11, 22, 34, 44, 55])
  const link = await CAR_LEGACY.codec.link(data)
  const workflow = await CAR_LEGACY.encode([
    await createUcanInvocation(
      storeAdd.can,
      { link, size: data.byteLength }
    ),
    await createUcanInvocation(
      uploadAdd.can,
      { root: link }
    )
  ])
  const decodedWorkflowCar = await CAR_LEGACY.codec.decode(workflow.body)

  // Create Workflow request with car
  const workflowRequest = lambdaUtils.mockEventCreator.createAPIGatewayEvent({
    headers: {
      authorization: `Basic ${basicAuth}`,
      'content-type': CONTENT_TYPE.WORKFLOW
    },
    body: toString(workflow.body, 'base64')
  })

  // Handles invocation
  await t.notThrowsAsync(() => processUcanLogRequest(workflowRequest, {
    invocationBucket: stores.invocation.bucket,
    taskBucket: stores.task.bucket,
    workflowBucket: stores.workflow.bucket,
    basicAuth,
    streamName,
    kinesisClient: {
      // @ts-expect-error not same return type
      putRecords: (input) => {
        t.is(input.StreamName, streamName)
        t.is(input.Records?.length, decodedWorkflowCar.roots.length)

        const can = new Set()
        for (const record of input.Records || []) {
          if (!record.Data) {
            throw new Error('must have Data')
          }
          const invocation = JSON.parse(toString(record.Data))
          t.truthy(invocation)
          t.is(invocation.type, STREAM_TYPE.WORKFLOW)
          can.add(invocation.value.att[0].can)
        }

        // 2 different invocations
        t.is(can.size, 2)

        return Promise.resolve()
      }
    }
  }))

  // Verify workflow persisted
  const workflowCid = decodedWorkflowCar.roots[0].cid.toString()
  const cmd = new HeadObjectCommand({
    Key: `${workflowCid}/${workflowCid}`,
    Bucket: stores.workflow.name,
  })
  const s3Response = await t.context.s3.send(cmd)
  t.is(s3Response.$metadata.httpStatusCode, 200)

  // Verify all invocations persisted
  for (const root of decodedWorkflowCar.roots) {
    const invocationCid = root.cid.toString()
    // Verify invocation mapping within workflow stored
    const cmdInvocationStored = new HeadObjectCommand({
      Key: `${invocationCid}/${workflowCid}.workflow`,
      Bucket: stores.invocation.name,
    })
    const s3ResponseInvocationStored = await t.context.s3.send(cmdInvocationStored)
    t.is(s3ResponseInvocationStored.$metadata.httpStatusCode, 200)
  }
})

test('can process ucan log request for given receipt after its invocation stored', async t => {
  const stores = await getStores(t.context)
  const basicAuth = 'test-token'
  const streamName = 'stream-name'
  const uploadService = await Signer.generate()

  // Create workflow with one UCAN invocation
  const data = new Uint8Array([11, 22, 34, 44, 55])
  const link = await CAR_LEGACY.codec.link(data)
  const workflow = await CAR_LEGACY.encode([
    await createUcanInvocation(
      storeAdd.can,
      { link, size: data.byteLength }
    )
  ])
  const requestCar = await CAR_LEGACY.codec.decode(workflow.body)
  const invocationCid = requestCar.roots[0].cid
  const taskCid = invocationCid

  // Create Workflow request with car
  const workflowRequest = lambdaUtils.mockEventCreator.createAPIGatewayEvent({
    headers: {
      authorization: `Basic ${basicAuth}`,
      'content-type': CONTENT_TYPE.WORKFLOW
    },
    body: toString(workflow.body, 'base64')
  })

  // process ucan log request for workflow
  /** @type {any[]} */
  const kinesisWorkflowInvocations = []
  await t.notThrowsAsync(() => processUcanLogRequest(workflowRequest, {
    invocationBucket: stores.invocation.bucket,
    taskBucket: stores.task.bucket,
    workflowBucket: stores.workflow.bucket,
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
  const out = { ok: 'Done' }
  const receipt = await createReceipt(invocationCid, out, uploadService.signer)

  // Create receipt request with cbor
  const receiptBlock = await CBOR_LEGACY.codec.write(receipt)
  const receiptRequest = lambdaUtils.mockEventCreator.createAPIGatewayEvent({
    headers: {
      authorization: `Basic ${basicAuth}`,
      'content-type': CONTENT_TYPE.RECEIPT
    },
    body: toString(receiptBlock.bytes, 'base64')
  })

  // process ucan log request for receipt
  await t.notThrowsAsync(() => processUcanLogRequest(receiptRequest, {
    invocationBucket: stores.invocation.bucket,
    taskBucket: stores.task.bucket,
    workflowBucket: stores.workflow.bucket,
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
        t.is(data.carCid, invocationCid.toString())
        t.is(data.invocationCid, receiptBlock.cid.toString())
        t.is(data.type, STREAM_TYPE.RECEIPT)
        t.deepEqual(data.out, out)
        t.deepEqual(data.value, kinesisWorkflowInvocations[0].value)
        return Promise.resolve()
      }
    }
  }))

  // Validate invocation receipt block
  const cmdReceiptBlock = new GetObjectCommand({
    Key: `${invocationCid.toString()}/${invocationCid.toString()}.receipt`,
    Bucket: stores.invocation.name,
  })
  const s3ResponseReceiptBlock = await t.context.s3.send(cmdReceiptBlock)
  t.is(s3ResponseReceiptBlock.$metadata.httpStatusCode, 200)

  // @ts-expect-error AWS types with readable stream
  const s3ReceiptBlockBytes = (await s3ResponseReceiptBlock.Body.toArray())[0]
  t.truthy(equals(s3ReceiptBlockBytes, receiptBlock.bytes))

  // Validate stored task result
  const cmdTaskResult = new GetObjectCommand({
    Key: `${taskCid}/${taskCid}.result`,
    Bucket: stores.task.name,
  })
  const s3ResponseTaskResult = await t.context.s3.send(cmdTaskResult)
  t.is(s3ResponseTaskResult.$metadata.httpStatusCode, 200)

  // @ts-expect-error AWS types with readable stream
  const s3TaskResultBytes = (await s3ResponseTaskResult.Body.toArray())[0]
  const taskResult = await CBOR_LEGACY.codec.write({
    out
  })
  t.truthy(equals(s3TaskResultBytes, taskResult.bytes))
  
  // Validate task index within invocation stored
  const cmdTaskIndexStored = new HeadObjectCommand({
    Key: `${taskCid}/${invocationCid}.invocation`,
    Bucket: stores.task.name,
  })
  const s3ResponseTaskIndexStored = await t.context.s3.send(cmdTaskIndexStored)
  t.is(s3ResponseTaskIndexStored.$metadata.httpStatusCode, 200)
})

test('fails to process ucan log request for given receipt when no associated invocation is stored', async t => {
  const stores = await getStores(t.context)
  const basicAuth = 'test-token'
  const streamName = 'stream-name'
  const uploadService = await Signer.generate()

  // Create workflow with one UCAN invocation
  const data = new Uint8Array([11, 22, 34, 44, 55])
  const link = await CAR_LEGACY.codec.link(data)
  const workflow = await CAR_LEGACY.encode([
    await createUcanInvocation(
      storeAdd.can,
      { link, size: data.byteLength }
    )
  ])
  const requestCar = await CAR_LEGACY.codec.decode(workflow.body)
  const requestCarRootCid = requestCar.roots[0].cid

  // create receipt
  const receipt = await createReceipt(
    requestCarRootCid,
    { ok: 'Done' },
    uploadService.signer
  )

  // Create receipt request with cbor
  const { bytes: receiptBytes } = await CBOR_LEGACY.codec.write(receipt)
  const requestReceipt = lambdaUtils.mockEventCreator.createAPIGatewayEvent({
    headers: {
      authorization: `Basic ${basicAuth}`,
      'content-type': CONTENT_TYPE.RECEIPT
    },
    body: toString(receiptBytes, 'base64')
  })

  // Fails handling receipt request given no invocation for it is stored
  await t.throwsAsync(() => processUcanLogRequest(requestReceipt, {
    invocationBucket: stores.invocation.bucket,
    taskBucket: stores.task.bucket,
    workflowBucket: stores.workflow.bucket,
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
  const stores = await getStores(t.context)
  const basicAuth = 'test-token'
  const request = lambdaUtils.mockEventCreator.createAPIGatewayEvent({
    headers: {
      authorization: `Basic ${basicAuth}`,
      'content-type': 'unknown'
    }
  })

  await t.throwsAsync(() => processUcanLogRequest(request, {
    invocationBucket: stores.invocation.bucket,
    taskBucket: stores.task.bucket,
    workflowBucket: stores.workflow.bucket,
    streamName: 'name',
    basicAuth
  }))
})

test('fails to process ucan log request with no Authorization header', async t => {
  const stores = await getStores(t.context)
  const basicAuth = 'test-token'
  const request = lambdaUtils.mockEventCreator.createAPIGatewayEvent()

  await t.throwsAsync(() => processUcanLogRequest(request, {
    invocationBucket: stores.invocation.bucket,
    taskBucket: stores.task.bucket,
    workflowBucket: stores.workflow.bucket,
    streamName: 'name',
    basicAuth
  }))
})

test('fails to process ucan log request with no Authorization basic header', async t => {
  const stores = await getStores(t.context)
  const basicAuth = 'test-token'
  const request = lambdaUtils.mockEventCreator.createAPIGatewayEvent({
    headers: {
      authorization: 'Bearer token-test'
    }
  })

  await t.throwsAsync(() => processUcanLogRequest(request, {
    invocationBucket: stores.invocation.bucket,
    taskBucket: stores.task.bucket,
    workflowBucket: stores.workflow.bucket,
    streamName: 'name',
    basicAuth
  }))
})

test('fails to process ucan log request with Authorization basic token empty', async t => {
  const stores = await getStores(t.context)
  const basicAuth = 'test-token'
  const request = lambdaUtils.mockEventCreator.createAPIGatewayEvent({
    headers: {
      authorization: 'Basic'
    }
  })

  await t.throwsAsync(() => processUcanLogRequest(request, {
    invocationBucket: stores.invocation.bucket,
    taskBucket: stores.task.bucket,
    workflowBucket: stores.workflow.bucket,
    streamName: 'name',
    basicAuth
  }))
})

test('fails to process ucan log request with invalid Authorization basic token', async t => {
  const stores = await getStores(t.context)
  const basicAuth = 'test-token'
  const request = lambdaUtils.mockEventCreator.createAPIGatewayEvent({
    headers: {
      authorization: 'Basic invalid-token'
    }
  })

  await t.throwsAsync(() => processUcanLogRequest(request, {
    invocationBucket: stores.invocation.bucket,
    taskBucket: stores.task.bucket,
    workflowBucket: stores.workflow.bucket,
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
 * @param {{ s3: any; }} ctx
 */
async function getStores (ctx) {
  const { invocationBucketName, taskBucketName, workflowBucketName } = await prepareResources(ctx.s3)

  return {
    invocation: {
      bucket: useInvocationStore(ctx.s3, invocationBucketName),
      name: invocationBucketName
    },
    task: {
      bucket: useTaskStore(ctx.s3, taskBucketName),
      name: taskBucketName
    },
    workflow: {
      bucket: useWorkflowStore(ctx.s3, workflowBucketName),
      name: workflowBucketName
    }
  }
}

/**
 * @param {import("@aws-sdk/client-s3").S3Client} s3Client
 */
async function prepareResources(s3Client) {
  const invocationBucketName = await createBucket(s3Client)
  const taskBucketName = await createBucket(s3Client)
  const workflowBucketName = await createBucket(s3Client)

  return {
    invocationBucketName,
    taskBucketName,
    workflowBucketName
  }
}
