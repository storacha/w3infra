import { testStore as test } from './helpers/context.js'

import pWaitFor from 'p-wait-for'
import { HeadObjectCommand } from '@aws-sdk/client-s3'
import { PutItemCommand } from '@aws-sdk/client-dynamodb'
import { marshall } from '@aws-sdk/util-dynamodb'
import * as StoreCapabilities from '@web3-storage/capabilities/store'
import { ShardingStream, UnixFS, Store, Upload } from '@web3-storage/upload-client'

import {
  getApiEndpoint,
  getAwsBucketClient,
  getCloudflareBucketClient,
  getSatnavBucketInfo,
  getCarparkBucketInfo,
  getDynamoDb,
} from './helpers/deployment.js'
import { createMailSlurpInbox, setupNewClient, getServiceProps } from './helpers/up-client.js'
import { randomFile } from './helpers/random.js'

test.before(t => {
  t.context = {
    apiEndpoint: getApiEndpoint(),
    rateLimitsDynamo: getDynamoDb('rate-limit')
  }
})

// Integration test for all uploading flow with `store/add`
test('store protocol integration flow', async t => {
  const inbox = await createMailSlurpInbox()
  const client = await setupNewClient(t.context.apiEndpoint, { inbox })
  const serviceProps = getServiceProps(client, t.context.apiEndpoint, StoreCapabilities.add.can)
  const spaceDid = client.currentSpace()?.did()
  if (!spaceDid) {
    throw new Error('Testing space DID must be set')
  }

  const s3Client = getAwsBucketClient()
  const r2Client = getCloudflareBucketClient()

  const file = await randomFile(100)

  // Encode file as Unixfs and perform store/add
  const blocksReadableStream = UnixFS.createFileEncoderStream(file)
  /** @type {import('@web3-storage/upload-client/types').CARLink[]} */
  const shards = []
  /** @type {import('@web3-storage/upload-client/types').AnyLink | undefined} */
  let root

  await blocksReadableStream
    .pipeThrough(new ShardingStream())
    .pipeThrough(
      new TransformStream({
        async transform(car, controller) {
          const bytes = new Uint8Array(await car.arrayBuffer())
          // Invoke store/add and write bytes to write target
          const cid = await Store.add(serviceProps.conf, bytes, { connection: serviceProps.connection })

          const { version, roots, size } = car
          controller.enqueue({ version, roots, size, cid })

        }
      })
    )
    .pipeTo(
      new WritableStream({
        write(meta) {
          root = root || meta.roots[0]
          shards.push(meta.cid)
        },
      })
    )

  if (root === undefined) throw new Error('missing root CID')
  t.is(shards.length, 1)

  // Invoke upload/add
  await Upload.add(serviceProps.conf, root, shards, { connection: serviceProps.connection })

  // Check carpark
  const carparkRequest = await s3Client.send(
    new HeadObjectCommand({
      Bucket: (getCarparkBucketInfo()).Bucket,
      Key: `${shards[0].toString()}/${shards[0].toString()}.car`
    })
  )
  t.is(carparkRequest.$metadata.httpStatusCode, 200)

  // const carSize = carparkRequest.ContentLength
  // Check dudewhere
  const dudewhereRequest = await r2Client.send(
    new HeadObjectCommand({
      Bucket: process.env.R2_DUDEWHERE_BUCKET_NAME || '',
      Key: `${root.toString()}/${shards[0].toString()}`
    })
  )
  t.is(dudewhereRequest.$metadata.httpStatusCode, 200)

  // List space files
  let uploadFound, cursor
  do {
    const listResult = await client.capability.upload.list({
      size: 5,
      cursor
    })
    uploadFound = listResult.results.find(upload => upload.root.equals(root))
    cursor = listResult.cursor
  } while (!uploadFound)

  t.is(uploadFound.shards?.length, 1)
  for (let i = 0; i < shards.length; i++) {
    t.truthy(shards[i].equals(uploadFound.shards?.[i]))
  }

  // Remove file from space
  const removeResult = await client.capability.upload.remove(root)
  // @ts-expect-error error type not found
  t.falsy(removeResult?.error)

  // Check Satnav side index asynchronously created
  await pWaitFor(async () => {
    let satnavRequest
    try {
      satnavRequest = await s3Client.send(
        new HeadObjectCommand({
          Bucket: (getSatnavBucketInfo()).Bucket,
          Key: `${shards[0].toString()}/${shards[0].toString()}.car.idx`
        })
      )
    } catch {}

    return satnavRequest?.$metadata.httpStatusCode === 200
  }, {
    interval: 100,
  })

  // Replicator
  // Check carpark
  await pWaitFor(async () => {
    let carpark
    try {
      carpark = await r2Client.send(
        new HeadObjectCommand({
          Bucket: process.env.R2_CARPARK_BUCKET_NAME || '',
          Key: `${shards[0].toString()}/${shards[0].toString()}.car`
        })
      )
    } catch {}

    return carpark?.$metadata.httpStatusCode === 200
  }, {
    interval: 100,
  })

  // Check satnav
  await pWaitFor(async () => {
    let satnav
    try {
      satnav = await r2Client.send(
        new HeadObjectCommand({
          Bucket: process.env.R2_SATNAV_BUCKET_NAME || '',
          Key: `${shards[0].toString()}/${shards[0].toString()}.car.idx`
        })
      )
    } catch {}

    return satnav?.$metadata.httpStatusCode === 200
  }, {
    interval: 100,
  })

  // Verify w3s.link can resolve uploaded file
  const w3linkResponse = await fetch(
    `https://${root}.ipfs-staging.w3s.link`,
    {
      method: 'HEAD'
    }
  )
  t.is(w3linkResponse.status, 200)

  // verify that blocking a space makes it impossible to upload a file to it
  await t.context.rateLimitsDynamo.client.send(new PutItemCommand({
    TableName: t.context.rateLimitsDynamo.tableName,
    Item: marshall({
      id: Math.random().toString(10),
      subject: client.currentSpace()?.did(),
      rate: 0
    })
  }))
  const uploadError = await t.throwsAsync(async () => {
    await client.capability.store.add(await randomFile(100))
  })

  t.is(uploadError?.message, 'failed store/add invocation')
})
