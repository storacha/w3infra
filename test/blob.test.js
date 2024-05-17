import { testBlob as test } from './helpers/context.js'

import pWaitFor from 'p-wait-for'
import * as BlobCapabilities from '@web3-storage/capabilities/blob'
import { base58btc } from 'multiformats/bases/base58'
import * as Link from 'multiformats/link'
import { equals } from 'multiformats/bytes'
import { code as RAW_CODE } from 'multiformats/codecs/raw'
import { HeadObjectCommand } from '@aws-sdk/client-s3'
import { Assert } from '@web3-storage/content-claims/capability'
import { ShardingStream, UnixFS, Upload, Index } from '@web3-storage/upload-client'
import { codec as carCodec } from '@ucanto/transport/car'
import { ShardedDAGIndex } from '@web3-storage/blob-index'
import { useReceiptsStorage } from '../upload-api/stores/receipts.js'

import { METRICS_NAMES, SPACE_METRICS_NAMES } from '../upload-api/constants.js'

import * as Blob from './helpers/blob-client.js'
import {
  getStage,
  getApiEndpoint,
  getAwsBucketClient,
  getCloudflareBucketClient,
  getCarparkBucketInfo,
  getRoundaboutEndpoint,
  getDynamoDb,
} from './helpers/deployment.js'
import { randomFile } from './helpers/random.js'
import { createMailSlurpInbox, setupNewClient, getServiceProps } from './helpers/up-client.js'
import { getMetrics, getSpaceMetrics } from './helpers/metrics.js'

test.before(t => {
  t.context = {
    apiEndpoint: getApiEndpoint(),
    roundaboutEndpoint: getRoundaboutEndpoint(),
    metricsDynamo: getDynamoDb('admin-metrics'),
    spaceMetricsDynamo: getDynamoDb('space-metrics'),
  }
})

/**
 * @typedef {import('multiformats').UnknownLink} UnknownLink
 */

/**
 * Integration test for all flow from `blob/add` and `index/add`, to read interfaces and kinesis stream.
 * 1. Login client
 * 2. Get metrics before uploading any data
 * 3. Add a Blob
 * 4. Add an Index and Upload associated with the Blob previously added
 * 5. Check Blob was correctly stored on bucket
 * 6. Check Index was correctly stored on bucket
 * 7. Check receceipts were stored
 * 8. Read from Roundabout
 * 9. Read from w3link
 * 10. Read from Hoverboard
 * 11. Verify metrics
 */
test('blob integration flow with receipts validation', async t => {
  const stage = getStage()
  const inbox = await createMailSlurpInbox()
  const client = await setupNewClient(t.context.apiEndpoint, { inbox })
  const serviceProps = getServiceProps(client, t.context.apiEndpoint, BlobCapabilities.add.can)
  const spaceDid = client.currentSpace()?.did()
  if (!spaceDid) {
    throw new Error('Testing space DID must be set')
  }

  // Get space metrics before blob/add
  const spaceBeforeBlobAddMetrics = await getSpaceMetrics(t, spaceDid, SPACE_METRICS_NAMES.BLOB_ADD_TOTAL)
  const spaceBeforeBlobAddSizeMetrics = await getSpaceMetrics(t, spaceDid, SPACE_METRICS_NAMES.BLOB_ADD_SIZE_TOTAL)

  // Get metrics before upload
  const beforeOperationMetrics = await getMetrics(t)
  const beforeBlobAddTotal = beforeOperationMetrics.find(row => row.name === METRICS_NAMES.BLOB_ADD_TOTAL)
  const beforeBlobAddSizeTotal = beforeOperationMetrics.find(row => row.name === METRICS_NAMES.BLOB_ADD_SIZE_TOTAL)

  // Prepare data
  const file = await randomFile(100)
  
  // Encode file as Unixfs and perform store/add
  const blocksReadableStream = UnixFS.createFileEncoderStream(file)
  /** @type {import('@web3-storage/upload-client/types').CARLink[]} */
  const shards = []
  /** @type {Uint8Array[]} */
  const shardBytes = []
  /** @type {Array<Map<import('@web3-storage/upload-client/types').SliceDigest, import('@web3-storage/upload-client/types').Position>>} */
  const shardIndexes = []
  /** @type {import('@web3-storage/upload-client/types').AnyLink | undefined} */
  let root

  /** @type {import('multiformats/hashes/digest').Digest<18, number> | undefined} */
  let multihash
  /** @type {{ put: any, accept: { task: any }} | undefined} */
  let next
  await blocksReadableStream
    .pipeThrough(new ShardingStream())
    .pipeThrough(
      new TransformStream({
        async transform(car, controller) {
          const bytes = new Uint8Array(await car.arrayBuffer())

          // Add blob using custom client to be able to access receipts
          // Given Blob client exported from client would only return multihash
          const res = await Blob.add(serviceProps.conf, bytes, { connection: serviceProps.connection })
          t.truthy(res)
          t.truthy(res.multihash)
          multihash = res.multihash
          next = res.next

          const cid = Link.create(carCodec.code, res.multihash)
          const { version, roots, size, slices } = car
          controller.enqueue({ version, roots, size, cid, slices, bytes })
        }
      })
    )
    .pipeTo(
      new WritableStream({
        write(meta) {
          root = root || meta.roots[0]
          shards.push(meta.cid)
          shardBytes.push(meta.bytes)

          // add the CAR shard itself to the slices
          meta.slices.set(meta.cid.multihash, [0, meta.size])
          shardIndexes.push(meta.slices)
        },
      })
    )

  if (root === undefined) throw new Error('missing root CID')
  if (multihash === undefined) throw new Error('missing multihash')
  t.is(shards.length, 1)

  // Add the index with `index/add`
  const index = ShardedDAGIndex.create(root)
  for (const [i, shard] of shards.entries()) {
    const slices = shardIndexes[i]
    index.shards.set(shard.multihash, slices)
  }
  const indexBytes = await index.archive()
  if (!indexBytes.ok) {
    throw new Error('failed to archive DAG index', { cause: indexBytes.error })
  }
  // Store the index in the space
  const resIndex = await Blob.add(serviceProps.conf, indexBytes.ok, { connection: serviceProps.connection })
  const indexLink = Link.create(carCodec.code, resIndex.multihash)

  // Register the index with the service
  await Index.add(serviceProps.conf, indexLink, { connection: serviceProps.connection })
  // Register an upload with the service
  await Upload.add(serviceProps.conf, root, shards, { connection: serviceProps.connection })

  // Get bucket clients
  const s3Client = getAwsBucketClient()
  const r2Client = getCloudflareBucketClient()

  // Check blob exists in R2, but not S3
  const encodedMultihash = base58btc.encode(multihash.bytes)
  const r2Request = await r2Client.send(
    new HeadObjectCommand({
      // Env var
      Bucket: 'carpark-staging-0',
      Key: `${encodedMultihash}/${encodedMultihash}.blob`,
    })
  )
  t.is(r2Request.$metadata.httpStatusCode, 200)
  const carSize = r2Request.ContentLength
  try {
    await s3Client.send(
      new HeadObjectCommand({
        Bucket: (getCarparkBucketInfo()).Bucket,
        Key: `${encodedMultihash}/${encodedMultihash}.blob`,
      })
    )
  } catch (cause) {
    t.is(cause?.$metadata?.httpStatusCode, 404)
  }

  // Check index exists in R2
  const encodedIndexMultihash = base58btc.encode(resIndex.multihash.bytes)
  const r2IndexRequest = await r2Client.send(
    new HeadObjectCommand({
      // Env var
      Bucket: 'carpark-staging-0',
      Key: `${encodedIndexMultihash}/${encodedIndexMultihash}.blob`,
    })
  )
  t.is(r2IndexRequest.$metadata.httpStatusCode, 200)

  // Check receipts were written
  const receiptsStorage = useReceiptsStorage(s3Client, `task-store-${stage}-0`, `invocation-store-${stage}-0`, `workflow-store-${stage}-0`)
  const getPutTaskReceipt = await receiptsStorage.get(next?.put.task.link())
  t.truthy(getPutTaskReceipt.ok?.out.ok)
  t.deepEqual(getPutTaskReceipt.ok?.out.ok, {})

  const getAcceptTaskReceipt = await receiptsStorage.get(next?.accept.task.link())
  t.truthy(getAcceptTaskReceipt.ok?.out.ok)
  t.truthy(getAcceptTaskReceipt.ok?.out.ok.site)

  // Check delegation
  const acceptForks = getAcceptTaskReceipt.ok?.fx.fork
  if (!acceptForks) {
    throw new Error('must have a fork')
  }
  t.is(acceptForks?.length, 1)
  t.truthy(acceptForks?.find(f => f.capabilities[0].can === Assert.location.can))

  // Read from Roundabout and check bytes can be read by raw CID
  const rawCid = Link.create(RAW_CODE, multihash)
  const roundaboutResponse = await fetch(
    `${t.context.roundaboutEndpoint}/${rawCid.toString()}`
  )
  t.is(roundaboutResponse.status, 200)

  const fetchedBytes =  new Uint8Array(await roundaboutResponse.arrayBuffer())
  t.truthy(equals(shardBytes[0], fetchedBytes))

  // Verify w3link can resolve uploaded file via HTTP
  console.log('Uploaded file link', root)
  const w3linkResponse = await fetch(
    `https://${root}.ipfs-staging.w3s.link`,
    {
      method: 'HEAD'
    }
  )
  t.is(w3linkResponse.status, 200)

  // Verify hoverboard can resolved uploaded root via Bitswap

  // Should find our deployed hoverboard URL https://github.com/web3-storage/hoverboard
  // use https://github.com/ipfs/helia to connect to hoverboard peer and read som bytes

  // Validate metrics
  console.log('check metrics match work done')
  // Check metrics were updated
  if (beforeBlobAddSizeTotal && spaceBeforeBlobAddSizeMetrics) {
    await pWaitFor(async () => {
      const afterOperationMetrics = await getMetrics(t)
      const afterBlobAddTotal = afterOperationMetrics.find(row => row.name === METRICS_NAMES.BLOB_ADD_TOTAL)
      const afterBlobAddSizeTotal = afterOperationMetrics.find(row => row.name === METRICS_NAMES.BLOB_ADD_SIZE_TOTAL)
      const spaceAfterBlobAddMetrics = await getSpaceMetrics(t, spaceDid, SPACE_METRICS_NAMES.BLOB_ADD_TOTAL)
      const spaceAfterBlobAddSizeMetrics = await getSpaceMetrics(t, spaceDid, SPACE_METRICS_NAMES.BLOB_ADD_SIZE_TOTAL)

      // If staging accept more broad condition given multiple parallel tests can happen there
      if (stage === 'staging') {
        return (
          afterBlobAddTotal?.value >= beforeBlobAddTotal?.value + 1 &&
          afterBlobAddSizeTotal?.value >= beforeBlobAddSizeTotal.value + carSize &&
          spaceAfterBlobAddMetrics?.value >= spaceBeforeBlobAddMetrics?.value + 1 &&
          spaceAfterBlobAddSizeMetrics?.value >= spaceBeforeBlobAddSizeMetrics?.value + carSize
        )
      }

      return (
        afterBlobAddTotal?.value === beforeBlobAddTotal?.value + 1 &&
        afterBlobAddSizeTotal?.value === beforeBlobAddSizeTotal.value + carSize &&
        spaceAfterBlobAddMetrics?.value === spaceBeforeBlobAddMetrics?.value + 1 &&
        spaceAfterBlobAddSizeMetrics?.value === spaceBeforeBlobAddSizeMetrics?.value + carSize
      )
    })
  }
})
