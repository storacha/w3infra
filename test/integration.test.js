import { fetch } from '@web-std/fetch'
import git from 'git-rev-sync'
import pWaitFor from 'p-wait-for'
// import { unixfs } from '@helia/unixfs'
// import { multiaddr } from '@multiformats/multiaddr'
import * as Link from 'multiformats/link'
import { code as RAW_CODE } from 'multiformats/codecs/raw'
import { base58btc } from 'multiformats/bases/base58'
import { equals } from 'multiformats/bytes'
import * as Digest from 'multiformats/hashes/digest'
import { PutItemCommand } from '@aws-sdk/client-dynamodb'
import { marshall } from '@aws-sdk/util-dynamodb'
import * as DidMailto from '@storacha/did-mailto'
import { METRICS_NAMES, SPACE_METRICS_NAMES } from '../upload-api/constants.js'
import { test, withCauseLog } from './helpers/context.js'
import {
  getStage,
  getApiEndpoint,
  getRoundaboutEndpoint,
  getReceiptsEndpoint,
  getDynamoDb
} from './helpers/deployment.js'
import { createMailSlurpInbox, createNewClient, setupNewClient } from './helpers/up-client.js'
import { randomFile } from './helpers/random.js'
import { getMetrics, getSpaceMetrics } from './helpers/metrics.js'
// import { createNode } from './helpers/helia.js'
import * as IndexingService from './helpers/indexing-service.js'

/** @param {import('multiformats').MultihashDigest} d */
const b58 = d => base58btc.encode(d.bytes)
/** @param {import('multiformats').UnknownLink|{ digest: Uint8Array }} c */
const toDigest = c => 'multihash' in c ? c.multihash : Digest.decode(c.digest)

test.before(t => {
  t.context = {
    roundaboutEndpoint: getRoundaboutEndpoint(),
    metricsDynamo: getDynamoDb('admin-metrics'),
    spaceMetricsDynamo: getDynamoDb('space-metrics'),
    rateLimitsDynamo: getDynamoDb('rate-limit')
  }
})

test('GET /', async t => {
  const response = await fetch(getApiEndpoint())
  t.is(response.status, 200)
})

test('GET /version', async t => {
  const stage = getStage()
  const response = await fetch(`${getApiEndpoint()}/version`)
  t.is(response.status, 200)

  const body = await response.json()
  t.is(body.env, stage)
  t.is(body.commit, git.long('.'))
})

test('upload-api /metrics', async t => {
  const response = await fetch(`${getApiEndpoint()}/metrics`)
  t.is(response.status, 200)

  const body = await response.text()
  /**
   * # HELP w3up_bytes Total bytes associated with each invocation.
   * # TYPE w3up_bytes counter
   * w3up_bytes{can="store/add"} 0
   * w3up_bytes{can="store/remove"} 0
   * w3up_bytes{can="blob/add"} 0
   * w3up_bytes{can="blob/remove"} 0
   */
  t.is((body.match(/w3up_bytes/g) || []).length, 6)
  /**
   * # HELP w3up_invocations_total Total number of invocations.
   * # TYPE w3up_invocations_total counter
   * w3up_invocations_total{can="store/add"} 1
   * w3up_invocations_total{can="store/remove"} 0
   * w3up_invocations_total{can="upload/add"} 0
   * w3up_invocations_total{can="upload/remove"} 1
   * w3up_invocations_total{can="blob/add"} 1
   * w3up_invocations_total{can="blob/remove"} 0
   */
  t.is((body.match(/w3up_invocations_total/g) || []).length, 8)
})

test('authorizations can be blocked by email or domain', async t => {
  const client = await createNewClient()

  // test email blocking
  await t.context.rateLimitsDynamo.client.send(new PutItemCommand({
    TableName: t.context.rateLimitsDynamo.tableName,
    Item: marshall({
      id: Math.random().toString(10),
      subject: 'travis@example.com',
      rate: 0
    })
  }))

  // it would be nice to use t.throwsAsync here, but that doesn't work with errors that aren't exceptions: https://github.com/avajs/ava/issues/2517
  try {
    await client.authorize('travis@example.com')
    t.fail('authorize should fail with a blocked email address')
  } catch (/** @type {any} */ err) {
    t.is(err.name, 'AccountBlocked')
    t.is(err.message, 'Account identified by did:mailto:example.com:travis is blocked')
  }

  // test domain blocking
  await t.context.rateLimitsDynamo.client.send(new PutItemCommand({
    TableName: t.context.rateLimitsDynamo.tableName,
    Item: marshall({
      id: Math.random().toString(10),
      subject: 'example2.com',
      rate: 0
    })
  }))
  
  // it would be nice to use t.throwsAsync here, but that doesn't work with errors that aren't exceptions: https://github.com/avajs/ava/issues/2517
  try {
    await client.login('travis@example2.com')
    t.fail('authorize should fail with a blocked domain')
  } catch (/** @type {any} */ err) {
    t.is(err.name, 'AccountBlocked')
    t.is(err.message, 'Account identified by did:mailto:example2.com:travis is blocked')
  }
})

/**
 * Integration test for all main flow on uploading a file to read interfaces and kinesis stream
 * 1. Login client
 * 2. Create new space
 * 3. Get metrics before uploading any data
 * 4. Upload a small file with single Blob
 * 5. Check Blob was correctly stored on bucket
 * 6. Check Space Uploads include Blob
 * 7. Read from Roundabout
 * 8. Read from w3link
 * 9. Read from Hoverboard
 * 10. Remove
 * 11. Verify metrics
 */
test('w3infra store/upload integration flow', withCauseLog(async t => {
  const stage = getStage()
  const inbox = await createMailSlurpInbox()
  const { client } = await setupNewClient({ inbox })
  const spaceDid = client.currentSpace()?.did()
  if (!spaceDid) {
    throw new Error('Testing space DID must be set')
  }
  const account = client.accounts()[DidMailto.fromString(inbox.email)]

  // it should be possible to create more than one space
  const space = await client.createSpace('2nd space')
  await account.provision(space.did())
  await space.save()

  // Get space metrics before upload
  const spaceBeforeUploadAddMetrics = await getSpaceMetrics(t, spaceDid, SPACE_METRICS_NAMES.UPLOAD_ADD_TOTAL)
  const spaceBeforeBlobAddMetrics = await getSpaceMetrics(t, spaceDid, SPACE_METRICS_NAMES.BLOB_ADD_TOTAL)
  const spaceBeforeBlobAddSizeMetrics = await getSpaceMetrics(t, spaceDid, SPACE_METRICS_NAMES.BLOB_ADD_SIZE_TOTAL)

  // Get metrics before upload
  const beforeOperationMetrics = await getMetrics(t)
  const beforeBlobAddTotal = beforeOperationMetrics.find(row => row.name === METRICS_NAMES.BLOB_ADD_TOTAL)
  const beforeUploadAddTotal = beforeOperationMetrics.find(row => row.name === METRICS_NAMES.UPLOAD_ADD_TOTAL)
  const beforeBlobAddSizeTotal = beforeOperationMetrics.find(row => row.name === METRICS_NAMES.BLOB_ADD_SIZE_TOTAL)

  console.log('Creating new File')
  const file = await randomFile(100)
  /** @type {import('@storacha/upload-client/types').CARLink[]} */
  const shards = []
  /** @type {number[]} */
  const shardSizes = []

  // Upload new file
  const fileLink = await client.uploadFile(file, {
    onShardStored: (meta) => {
      shards.push(meta.cid)
      shardSizes.push(meta.size)
      console.log('Shard file written', meta.cid)
    },
    receiptsEndpoint: getReceiptsEndpoint()
  })
  t.truthy(fileLink)
  t.is(shards.length, 1)
  t.is(shardSizes.length, 1)
  console.log('Uploaded new file', fileLink)

  const rootDigest = fileLink.multihash
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
    .find(c => equals(toDigest(c.content).bytes, fileLink.multihash.bytes))
  if (!indexClaim) {
    return t.fail(`index claim not found for root: ${fileLink}`)
  }

  // find location commitment for index
  const indexLocationCommitment = claims
    .filter(c => c.type === 'assert/location')
    .find(c => equals(toDigest(c.content).bytes, indexClaim.index.multihash.bytes))
  if (!indexLocationCommitment) {
    return t.fail(`location commitment not found for index: ${b58(indexClaim.index.multihash)}`)
  }
  const indexHeadRes = await fetch(indexLocationCommitment.location[0])
  t.true(indexHeadRes.ok, `index not found at URL: ${indexLocationCommitment.location[0]}, status: ${indexHeadRes.status}`)
  console.log(`Index is retrievable at ${indexLocationCommitment.location[0]}`)

  // List space files
  let uploadFound, cursor
  do {
    const listResult = await client.capability.upload.list({
      size: 5,
      cursor
    })
    uploadFound = listResult.results.find(upload => upload.root.equals(fileLink))
    cursor = listResult.cursor
  } while (!uploadFound)

  t.is(uploadFound.shards?.length, 1)
  for (let i = 0; i < shards.length; i++) {
    t.truthy(uploadFound.shards?.[i].equals(shards[i]))
  }

  // Read from Roundabout returns 200
  const rawCid = Link.create(RAW_CODE, shards[0].multihash)
  console.log('Checking Roundabout can fetch raw content:', rawCid.toString())
  const roundaboutResponse = await fetch(
    `${t.context.roundaboutEndpoint}/${rawCid.toString()}`
  )
  t.is(roundaboutResponse.status, 200)

  if (process.env.DISABLE_IPNI_PUBLISHING !== 'true') {
    // Verify w3link can resolve uploaded file via HTTP
    console.log('Checking w3link can fetch root', fileLink.toString())
    const w3linkResponse = await fetch(
      `https://${fileLink}.ipfs-staging.w3s.link`,
      {
        method: 'HEAD'
      }
    )
    t.is(w3linkResponse.status, 200)
  }

  // FIXME: disabled due to eror:
  //   Error: Cannot find module '../build/Release/node_datachannel.node'
  // Verify hoverboard can resolved uploaded root via Bitswap
  // console.log('Checking Hoverboard can fetch root', fileLink.toString())
  // const helia = await createNode()
  // const heliaFs = unixfs(helia)
  // const hoverboardMultiaddr = multiaddr('/dns4/elastic-staging.dag.house/tcp/443/wss/p2p/Qmc5vg9zuLYvDR1wtYHCaxjBHenfCNautRwCjG3n5v5fbs')
  // console.log(`Dialing ${hoverboardMultiaddr}`)
  // await helia.libp2p.dial(hoverboardMultiaddr)

  // // @ts-expect-error link different from CID
  // const rootStat = await heliaFs.stat(fileLink)
  // t.truthy(rootStat)
  // t.is(rootStat.type, 'raw')
  // await helia.stop()

  // Remove file from space
  console.log(`Removing ${fileLink}`)
  const removeResult = await client.capability.upload.remove(fileLink)
  // @ts-expect-error error not typed
  t.falsy(removeResult?.error)

  console.log('Checking metrics match work done')
  // Check metrics were updated
  if (beforeBlobAddSizeTotal && spaceBeforeUploadAddMetrics && spaceBeforeBlobAddSizeMetrics && beforeUploadAddTotal) {
    await pWaitFor(async () => {
      const afterOperationMetrics = await getMetrics(t)
      const afterBlobAddTotal = afterOperationMetrics.find(row => row.name === METRICS_NAMES.BLOB_ADD_TOTAL)
      const afterUploadAddTotal = afterOperationMetrics.find(row => row.name === METRICS_NAMES.UPLOAD_ADD_TOTAL)
      const afterBlobAddSizeTotal = afterOperationMetrics.find(row => row.name === METRICS_NAMES.BLOB_ADD_SIZE_TOTAL)
      const spaceAfterUploadAddMetrics = await getSpaceMetrics(t, spaceDid, SPACE_METRICS_NAMES.UPLOAD_ADD_TOTAL)
      const spaceAfterBlobAddMetrics = await getSpaceMetrics(t, spaceDid, SPACE_METRICS_NAMES.BLOB_ADD_TOTAL)
      const spaceAfterBlobAddSizeMetrics = await getSpaceMetrics(t, spaceDid, SPACE_METRICS_NAMES.BLOB_ADD_SIZE_TOTAL)

      // If staging accept more broad condition given multiple parallel tests can happen there
      if (stage === 'staging') {
        return (
          afterBlobAddTotal?.value >= beforeBlobAddTotal?.value + 1 &&
          afterUploadAddTotal?.value === beforeUploadAddTotal?.value + 1 &&
          afterBlobAddSizeTotal?.value >= beforeBlobAddSizeTotal.value + shardSizes[0] &&
          spaceAfterBlobAddMetrics?.value >= spaceBeforeBlobAddMetrics?.value + 1 &&
          spaceAfterUploadAddMetrics?.value >= spaceBeforeUploadAddMetrics?.value + 1 &&
          spaceAfterBlobAddSizeMetrics?.value >= spaceBeforeBlobAddSizeMetrics?.value + shardSizes[0]
        )
      }

      return (
        afterBlobAddTotal?.value === beforeBlobAddTotal?.value + 1 &&
        afterUploadAddTotal?.value === beforeUploadAddTotal?.value + 1 &&
        afterBlobAddSizeTotal?.value === beforeBlobAddSizeTotal.value + shardSizes[0] &&
        spaceAfterBlobAddMetrics?.value === spaceBeforeBlobAddMetrics?.value + 1 &&
        spaceAfterUploadAddMetrics?.value === spaceBeforeUploadAddMetrics?.value + 1 &&
        spaceAfterBlobAddSizeMetrics?.value === spaceBeforeBlobAddSizeMetrics?.value + shardSizes[0]
      )
    })
  }
}))
