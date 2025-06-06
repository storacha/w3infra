import { testBlob as test } from './helpers/context.js'
import pWaitFor from 'p-wait-for'
import * as SpaceBlobCapabilities from '@storacha/capabilities/space/blob'
import * as UploadCapabilities from '@storacha/capabilities/upload'
import * as SpaceIndexCapabilities from '@storacha/capabilities/space/index'
import * as AssertCapabilities from '@storacha/capabilities/assert'
import { base58btc } from 'multiformats/bases/base58'
import * as Link from 'multiformats/link'
import { equals } from 'multiformats/bytes'
import { code as RAW_CODE } from 'multiformats/codecs/raw'
import * as Digest from 'multiformats/hashes/digest'
import { ShardingStream, UnixFS, Upload, Index } from '@storacha/upload-client'
import { isDelegation } from '@ucanto/core'
import { codec as carCodec } from '@ucanto/transport/car'
import { ShardedDAGIndex } from '@storacha/blob-index'
import * as AgentStore from '../upload-api/stores/agent.js'
import { METRICS_NAMES, SPACE_METRICS_NAMES } from '../upload-api/constants.js'
import * as Blob from './helpers/blob-client.js'
import {
  getStage,
  getAwsBucketClient,
  getRoundaboutEndpoint,
  getDynamoDb,
  getAwsRegion,
  getBucketName,
} from './helpers/deployment.js'
import { randomFile, randomInt } from './helpers/random.js'
import { setupNewClient, getServiceProps } from './helpers/up-client.js'
import { getMetrics, getSpaceMetrics } from './helpers/metrics.js'
import { getUsage } from './helpers/store.js'
import { addStorageProvider } from './helpers/storage-provider.js'
import * as IndexingService from './helpers/indexing-service.js'

/** @param {import('multiformats').MultihashDigest} d */
const b58 = d => base58btc.encode(d.bytes)
/** @param {import('multiformats').UnknownLink|{ digest: Uint8Array }} c */
const toDigest = c => 'multihash' in c ? c.multihash : Digest.decode(c.digest)

test.before(async t => {
  await addStorageProvider(getDynamoDb('storage-provider'))
  t.context = {
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
  try {
    const stage = getStage()
    const { client, account } = await setupNewClient()
    const serviceProps = getServiceProps(client, [
      SpaceBlobCapabilities.add.can,
      UploadCapabilities.add.can,
      SpaceIndexCapabilities.add.can
    ])
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

    const beforeOperationUsage = await getUsage(client, account)
    const spaceBeforeStoreAddUsage = beforeOperationUsage[spaceDid]
    
    // Prepare data
    console.log('Creating new File')
    const file = await randomFile(100)
    
    // Encode file as Unixfs and perform store/add
    const blocksReadableStream = UnixFS.createFileEncoderStream(file)
    /** @type {import('@storacha/upload-client/types').CARLink[]} */
    const shards = []
    /** @type {number[]} */
    const shardSizes = []
    /** @type {Uint8Array[]} */
    const shardBytes = []
    /** @type {Array<Map<import('@storacha/upload-client/types').SliceDigest, import('@storacha/upload-client/types').Position>>} */
    const shardIndexes = []
    /** @type {import('@storacha/upload-client/types').AnyLink | undefined} */
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
            shardSizes.push(meta.size)

            // add the CAR shard itself to the slices
            meta.slices.set(meta.cid.multihash, [0, meta.size])
            shardIndexes.push(meta.slices)
          },
        })
      )

    if (root === undefined) throw new Error('missing root CID')
    if (multihash === undefined) throw new Error('missing multihash')

    t.is(shards.length, 1)
    t.is(shardSizes.length, 1)

    console.log(`Added blob ${b58(multihash)}, root: ${root}`)

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

    console.log(`Added index ${indexLink} (${b58(resIndex.multihash)})`)
    // Register the index with the service
    await Index.add(serviceProps.conf, indexLink, { connection: serviceProps.connection })
    // Register an upload with the service
    await Upload.add(serviceProps.conf, root, shards, { connection: serviceProps.connection })

    const rootDigest = root.multihash
    const queryRes = await IndexingService.client.queryClaims({
      hashes: [rootDigest]
    })
    if (queryRes.error) {
      throw new Error(`querying indexing service (${IndexingService.serviceURL}) for: ${b58(rootDigest)}`, { cause: queryRes.error })
    }

    console.log(`Indexing service found ${queryRes.ok.claims.size} claim(s), ${queryRes.ok.indexes.size} index(es) for: ${b58(rootDigest)}`)
    // expect at least 1 index
    t.true(queryRes.ok.indexes.size > 0)
    // expect at least 3 claims:
    // 1) shard location commitment 2) index location commitment 3) index claim
    t.true(queryRes.ok.claims.size > 2)

    const claims = [...queryRes.ok.claims.values()]

    // find location commitment for shard
    const shardLocationCommitment = claims
      .filter(c => c.type === 'assert/location')
      .find(c => equals(toDigest(c.content).bytes, shards[0].multihash.bytes))
    if (!shardLocationCommitment) {
      return t.fail(`location commitment not found for shard: ${b58(shards[0].multihash)}`)
    }
    const shardHeadRes = await fetch(shardLocationCommitment.location[0])
    t.true(shardHeadRes.ok, `shard not found at URL: ${shardLocationCommitment.location[0]}, status: ${shardHeadRes.status}`)
    console.log(`Shard is retrievable at ${shardLocationCommitment.location[0]}`)

    // find index claim for root
    const indexClaim = claims
      .filter(c => c.type === 'assert/index')
      .find(c => (
        equals(toDigest(c.content).bytes, rootDigest.bytes) &&
        equals(c.index.multihash.bytes, indexLink.multihash.bytes)
      ))
    if (!indexClaim) {
      return t.fail(`index claim not found for root: ${root}, index: ${indexLink}`)
    }
  
    // find location commitment for index
    const indexLocationCommitment = claims
      .filter(c => c.type === 'assert/location')
      .find(c => (
        equals(toDigest(c.content).bytes, indexClaim.index.multihash.bytes)
      ))
    if (!indexLocationCommitment) {
      return t.fail(`location commitment not found for index: ${b58(indexClaim.index.multihash)}`)
    }
    const indexHeadRes = await fetch(indexLocationCommitment.location[0])
    t.true(indexHeadRes.ok, `index not found at URL: ${indexLocationCommitment.location[0]}, status: ${indexHeadRes.status}`)
    console.log(`Index is retrievable at ${indexLocationCommitment.location[0]}`)

    // Check receipts were written
    const s3Client = getAwsBucketClient()
    const agentStore = AgentStore.open({
      store: {
        region: getAwsRegion(),
        connection: { channel: s3Client },
        buckets: {
          message: { name: getBucketName('workflow-store') },
          index: { name: getBucketName('invocation-store') },
        },
      },
      stream: {
        connection: { disable: {} },
        name: '',
      },
    })
    const getPutTaskReceipt = await agentStore.receipts.get(next?.put.task.link())
    if (getPutTaskReceipt.error) {
      throw new Error(`get http/put receipt failed for: ${next?.put.task.link()}`, { cause: getPutTaskReceipt.error })
    }
    if (getPutTaskReceipt.ok.out.error) {
      throw new Error('http/put task failed', { cause: getPutTaskReceipt.ok.out.error })
    }
    t.deepEqual(getPutTaskReceipt.ok.out.ok, {})

    const getAcceptTaskReceipt = await agentStore.receipts.get(next?.accept.task.link())
    if (getAcceptTaskReceipt.error) {
      throw new Error(`get blob/accept receipt failed for: ${next?.accept.task.link()}`, { cause: getAcceptTaskReceipt.error })
    }
    if (getAcceptTaskReceipt.ok.out.error) {
      throw new Error('blob/accept task failed', { cause: getAcceptTaskReceipt.ok.out.error })
    }
    t.truthy(getAcceptTaskReceipt.ok?.out.ok)
    t.truthy(getAcceptTaskReceipt.ok?.out.ok.site)

    // Check delegation
    const acceptForks = getAcceptTaskReceipt.ok.fx.fork
    t.is(acceptForks.length, 1)
    t.true(
      isDelegation(acceptForks[0]) &&
      acceptForks[0].capabilities[0].can === AssertCapabilities.location.can
    )

    // Read from Roundabout and check bytes can be read by raw CID
    const rawCid = Link.create(RAW_CODE, multihash)
    console.log('Checking Roundabout can fetch raw content:', rawCid.toString())
    const roundaboutResponse = await fetch(
      `${t.context.roundaboutEndpoint}/${rawCid.toString()}`
    )
    t.is(roundaboutResponse.status, 200)

    const fetchedBytes =  new Uint8Array(await roundaboutResponse.arrayBuffer())
    t.truthy(equals(shardBytes[0], fetchedBytes))

    if (process.env.DISABLE_IPNI_PUBLISHING !== 'true') {
      // Verify w3link can resolve uploaded file
      console.log('Checking w3link can fetch root', root.toString())
      const gatewayURL = `https://${root}.ipfs-staging.w3s.link`
      const gatewayRetries = 5
      for (let i = 0; i < gatewayRetries; i++) {
        const controller = new AbortController()
        const timeoutID = setTimeout(() => controller.abort(), 5000)
        try {
          const res = await fetch(gatewayURL, { method: 'HEAD', signal: controller.signal })
          if (res.status === 200) break
        } catch (err) {
          console.error(`failed gateway fetch: ${root} (attempt ${i + 1})`, err)
          if (i === gatewayRetries - 1) throw err
        } finally {
          clearTimeout(timeoutID)
        }
        await new Promise(resolve => setTimeout(resolve, 1000))
      }
    }

    // Verify hoverboard can resolved uploaded root via Bitswap
    // TODO: can only use helia once
    // console.log('Checking Hoverboard can fetch root', root.toString())
    // const helia = await createNode()
    // const heliaFs = unixfs(helia)
    // const hoverboardMultiaddr = multiaddr('/dns4/elastic-staging.dag.house/tcp/443/wss/p2p/Qmc5vg9zuLYvDR1wtYHCaxjBHenfCNautRwCjG3n5v5fbs')
    // console.log(`Dialing ${hoverboardMultiaddr}`)
    // await helia.libp2p.dial(hoverboardMultiaddr)

    // // @ts-expect-error link different from CID
    // const rootStat = await heliaFs.stat(root)
    // t.truthy(rootStat)
    // t.is(rootStat.type, 'raw')

    // Validate metrics
    console.log('Checking metrics match work done')
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
            afterBlobAddSizeTotal?.value >= beforeBlobAddSizeTotal.value + shardSizes[0] &&
            spaceAfterBlobAddMetrics?.value >= spaceBeforeBlobAddMetrics?.value + 1 &&
            spaceAfterBlobAddSizeMetrics?.value >= spaceBeforeBlobAddSizeMetrics?.value + shardSizes[0]
          )
        }

        return (
          afterBlobAddTotal?.value === beforeBlobAddTotal?.value + 1 &&
          afterBlobAddSizeTotal?.value === beforeBlobAddSizeTotal.value + shardSizes[0] &&
          spaceAfterBlobAddMetrics?.value === spaceBeforeBlobAddMetrics?.value + 1 &&
          spaceAfterBlobAddSizeMetrics?.value === spaceBeforeBlobAddSizeMetrics?.value + shardSizes[0]
        )
      })
    }


    if (beforeOperationUsage) {
      console.log("Checking usage matches work done")
      await pWaitFor(async () => {
        const afterOperationUsage = await getUsage(client, account)
        const spaceAfterStoreAddUsage = afterOperationUsage[spaceDid]
        // If staging accept more broad condition given multiple parallel tests can happen there
        return (
            spaceAfterStoreAddUsage >= spaceBeforeStoreAddUsage + shardSizes[0]
        )
      })
    }
  } catch (/** @type {any} */ err) {
    console.error(err.stack)
    if (err.cause) console.error('[cause]:', err.cause)
    throw err
  }
})

test('10k NFT drop', async t => {
  try {
    const total = 20_000
    console.log('Creating client')
    const { client } = await setupNewClient()

    // Prepare data
    console.log('Creating NFT metadata')
    const id = crypto.randomUUID()
    const files = []
    const randomTrait = () => {
      const [traitType, value] = crypto.randomUUID().split('-')
      return { trait_type: traitType, value }
    }
    for (let i = 0; i < total; i++) {
      files.push(new File([JSON.stringify({
        name: `NFT #${i}`,
        description: 'NFT',
        attributes: Array.from(Array(randomInt(5)), randomTrait),
        compiler: 'storacha.network',
        external_url: `https://${id}.nft.storacha.network/token/${i}`
      })], `${i}.json`))
    }

    console.log('Uploading NFT metadata')
    const root = await client.uploadDirectory(files, {
      onShardStored ({ cid, size }) {
        console.log(`Uploaded blob ${cid} (${size} bytes)`)
      }
    })

    if (process.env.DISABLE_IPNI_PUBLISHING !== 'true') {
      const sample = Array.from(Array(5), () => randomInt(total))
      for (const index of sample) {
        // Verify gateway can resolve uploaded file
        const gatewayURL = `https://${root}.ipfs-staging.w3s.link/${index}.json`
        console.log('Checking gateway can fetch', gatewayURL)

        await t.notThrowsAsync(async () => {
          const gatewayRetries = 5
          for (let i = 0; i < gatewayRetries; i++) {
            const controller = new AbortController()
            const timeoutID = setTimeout(() => controller.abort(), 15_000)
            try {
              const res = await fetch(gatewayURL, { method: 'HEAD', signal: controller.signal })
              if (res.status === 200) break
            } catch (err) {
              console.error(`failed gateway fetch: ${gatewayURL} (attempt ${i + 1})`, err)
              if (i === gatewayRetries - 1) throw err
            } finally {
              clearTimeout(timeoutID)
            }
            await new Promise(resolve => setTimeout(resolve, 1000))
          }
        })
      }
    }
  } catch (/** @type {any} */ err) {
    console.error(err.stack)
    if (err.cause) console.error('[cause]:', err.cause)
    throw err
  }
})
