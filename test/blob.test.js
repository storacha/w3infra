import { testBlob as test } from './helpers/context.js'

import { base58btc } from 'multiformats/bases/base58'
import * as Link from 'multiformats/link'
import { equals } from 'multiformats/bytes'
import { code as RAW_CODE } from 'multiformats/codecs/raw'
import { HeadObjectCommand } from '@aws-sdk/client-s3'
import { Assert } from '@web3-storage/content-claims/capability'
import { useReceiptsStorage } from '../upload-api/stores/receipts.js'

import {
  getStage,
  getApiEndpoint,
  getAwsBucketClient,
  getCloudflareBucketClient,
  getCarparkBucketInfo,
  getRoundaboutEndpoint
} from './helpers/deployment.js'
import { randomFile } from './helpers/random.js'
import { createMailSlurpInbox, setupNewClientWithBlob } from './helpers/up-client.js'

test.before(t => {
  t.context = {
    apiEndpoint: getApiEndpoint(),
    roundaboutEndpoint: getRoundaboutEndpoint(),
  }
})

// Integration test for all flow from uploading a blob, to all the reads pipelines to work.
test('blob integration flow', async t => {
  const stage = getStage()
  const inbox = await createMailSlurpInbox()
  const { client, blobClient } = await setupNewClientWithBlob(t.context.apiEndpoint, { inbox })
  const spaceDid = client.currentSpace()?.did()
  if (!spaceDid) {
    throw new Error('Testing space DID must be set')
  }

  // Prepare data
  const file = await randomFile(100)
  const data = new Uint8Array(await file.arrayBuffer())

  // Add blob
  // TODO: Rely on new client
  const res = await blobClient.add(data)
  t.truthy(res)

  // Get bucket clients
  const s3Client = getAwsBucketClient()
  const r2Client = getCloudflareBucketClient()

  const encodedMultihash = base58btc.encode(res.multihash.bytes)
  // Check blob exists in R2, but not S3
  const r2Request = await r2Client.send(
    new HeadObjectCommand({
      // Env var
      Bucket: 'carpark-staging-0',
      Key: `${encodedMultihash}/${encodedMultihash}.blob`,
    })
  )
  t.is(r2Request.$metadata.httpStatusCode, 200)
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

  // TODO: are indexes written? check dudewhere + satnav (based on what Alan is woerking on for `index/add` handler)

  // Check receipts were written
  const receiptsStorage = useReceiptsStorage(s3Client, `task-store-${stage}-0`, `invocation-store-${stage}-0`, `workflow-store-${stage}-0`)
  const getPutTaskReceipt = await receiptsStorage.get(res.next.put.task.link())
  t.truthy(getPutTaskReceipt.ok?.out.ok)
  t.deepEqual(getPutTaskReceipt.ok?.out.ok, {})

  const getAcceptTaskReceipt = await receiptsStorage.get(res.next.accept.task.link())
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
  const rawCid = Link.create(RAW_CODE, res.multihash)
  const roundaboutResponse = await fetch(
    `${t.context.roundaboutEndpoint}/${rawCid.toString()}`
  )
  t.is(roundaboutResponse.status, 200)

  const fetchedBytes =  new Uint8Array(await roundaboutResponse.arrayBuffer())
  t.truthy(equals(data, fetchedBytes))

  // TODO: Read from w3link
  // fetch `https://${rootCid}.ipfs.w3s.link

  // Read from bitswap
  // use IPNI to find providers of CID
  // TODO: does IPNI have a client
  // cid.contact
  // Should find our deployed hoverboard URL https://github.com/web3-storage/hoverboard
  // dns4/elastic.ipfs??

  // use https://github.com/ipfs/helia to connect to hoverboard peer and read som bytes

})
