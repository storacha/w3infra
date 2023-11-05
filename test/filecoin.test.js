import { testFilecoin as test } from './helpers/context.js'
import { fetch } from '@web-std/fetch'
import pWaitFor from 'p-wait-for'
import { Storefront } from '@web3-storage/filecoin-client'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'

import { useReceiptStore } from '../filecoin/store/receipt.js'

import {
  getApiEndpoint,
  getAwsBucketClient,
  getRoundaboutEndpoint,
  getDynamoDb,
  stage
} from './helpers/deployment.js'
import { createMailSlurpInbox, setupNewClient } from './helpers/up-client.js'
import { getClientConfig } from './helpers/fil-client.js'
import { randomFile } from './helpers/random.js'
import { putTableItem, pollQueryTable } from './helpers/table.js'
import { waitForStoreOperationOkResult } from './helpers/store.js'

/**
 * @typedef {import('@web3-storage/w3up-client/src/types.js').CARLink} CARLink
 * @typedef {import('@web3-storage/data-segment').PieceLink} PieceLink
 */

test.before(t => {
  t.context = {
    apiEndpoint: getApiEndpoint(),
    pieceDynamo: getDynamoDb('piece-v1'),
  }
})

test('w3filecoin integration flow', async t => {
  const s3Client = getAwsBucketClient()
  const s3ClientFilecoin = getAwsBucketClient('us-east-2')
  const inbox = await createMailSlurpInbox()
  const endpoint = t.context.apiEndpoint

  // setup client connection config for w3filecoin pipeline entrypoint, i.e. API Storefront relies on
  const { invocationConfig, connection } = await getClientConfig(new URL(endpoint))

  // setup w3up client
  const client = await setupNewClient(endpoint, { inbox })
  const spaceDid = client.currentSpace()?.did()
  if (!spaceDid) {
    throw new Error('Testing space DID must be set')
  }
  
  console.log('uploading 4 files')
  const uploads = await Promise.all(Array.from({ length: 4 }).map(async () => {
      const file = await randomFile(1024)

      /** @type {{ content: CARLink, piece: PieceLink}[]} */
      const uploadFiles = []

      // Upload new file
      await client.uploadFile(file, {
        onShardStored: (meta) => {
          uploadFiles.push({
            content: meta.cid,
            piece: meta.piece
          })
          console.log(`shard file written with {${meta.cid}, ${meta.piece}}`)
        },
      })
      t.is(uploadFiles.length, 1)
      return uploadFiles[0]
    }
  ))

  // Shortcut if computing piece cid is disabled
  if (process.env.DISABLE_PIECE_CID_COMPUTE === 'true') {
    return
  }

  // Check filecoin pieces computed after leaving queue
  await Promise.all(uploads.map(async (upload) => {
    const pieces = await getPiecesByContent(t, upload.content.toString())
    t.assert(pieces)
    t.is(pieces?.length, 1)
    t.truthy(pieces?.[0].piece)
    t.is(pieces?.[0].piece, upload.piece.toString())
  }))

  const testUpload = uploads?.[0]

  // Check roundabout can redirect from pieceCid to signed bucket url for car
  const roundaboutEndpoint = await getRoundaboutEndpoint()
  const roundaboutUrl = new URL(testUpload.piece.toString(), roundaboutEndpoint)
  console.log('checking roundabout for one piece', roundaboutUrl.toString())
  await pWaitFor(async () => {
    try {
      const res = await fetch(roundaboutUrl, {
        method: 'HEAD',
        redirect: 'manual'
      })
      return res.status === 302 && res.headers.get('location')?.includes(testUpload.content.toString())
    } catch {}
    return false
  }, {
    interval: 100,
  })
  console.log('roundabout redirected from piece to car', roundaboutUrl.toString())

  // Invoke `filecoin/offer`
  console.log(`invoke 'filecoin/offer' for piece ${testUpload.piece.toString()} (${testUpload.content})`)
  const filecoinOfferRes = await Storefront.filecoinOffer(invocationConfig, testUpload.content, testUpload.piece, { connection })
  t.truthy(filecoinOfferRes.out.ok)
  t.truthy(filecoinOfferRes.fx.join)
  t.is(filecoinOfferRes.fx.fork.length, 1)

  const filecoinSubmitReceiptCid = filecoinOfferRes.fx.fork[0]
  const filecoinAcceptReceiptCid = filecoinOfferRes.fx.join?.link()
  console.log('filecoin/offer effects')
  console.log('filecoin/offer fork (filecoin/submit)', filecoinSubmitReceiptCid)
  console.log('filecoin/offer join (filecoin/accept)', filecoinAcceptReceiptCid)

  // Verify receipt chain
  console.log(`wait for receipt chain...`)
  const receiptStore = useReceiptStore(s3Client, `invocation-store-${stage}-0`, `workflow-store-${stage}-0`)
  const receiptStoreFilecoin = useReceiptStore(s3ClientFilecoin, 'invocation-store-staging-0', 'workflow-store-staging-0')

  // Await for `filecoin/submit` receipt
  console.log(`wait for filecoin/submit receipt ${filecoinSubmitReceiptCid.toString()} ...`)
  const receiptFilecoinSubmitRes = await waitForStoreOperationOkResult(
    () => receiptStore.get(filecoinSubmitReceiptCid),
    (res) => Boolean(res.ok)
  )
  
  // Await for `piece/offer` receipt
  const pieceOfferReceiptCid = receiptFilecoinSubmitRes.ok?.fx.join?.link()
  if (!pieceOfferReceiptCid) {
    throw new Error('filecoin/submit receipt has no effect for piece/offer')
  }
  console.log(`wait for piece/offer receipt ${pieceOfferReceiptCid.toString()} ...`)
  const receiptPieceOfferRes = await waitForStoreOperationOkResult(
    () => receiptStoreFilecoin.get(pieceOfferReceiptCid),
    (res) => Boolean(res.ok)
  )

  // Await for `piece/accept` receipt
  const pieceAcceptReceiptCid = receiptPieceOfferRes.ok?.fx.join?.link()
  if (!pieceAcceptReceiptCid) {
    throw new Error('piece/offer receipt has no effect for piece/accept')
  }
  console.log(`wait for piece/accept receipt ${pieceAcceptReceiptCid.toString()} ...`)
  const receiptPieceAcceptRes = await waitForStoreOperationOkResult(
    () => receiptStoreFilecoin.get(pieceAcceptReceiptCid),
    (res) => Boolean(res.ok)
  )

  // Await for `aggregate/offer` receipt
  const aggregateOfferReceiptCid = receiptPieceAcceptRes.ok?.fx.join?.link()
  if (!aggregateOfferReceiptCid) {
    throw new Error('piece/accept receipt has no effect for aggregate/offer')
  }
  console.log(`wait for aggregate/offer receipt ${aggregateOfferReceiptCid.toString()} ...`)
  const receiptAggregateOfferRes = await waitForStoreOperationOkResult(
    () => receiptStoreFilecoin.get(aggregateOfferReceiptCid),
    (res) => Boolean(res.ok)
  )

  // @ts-ignore no type for aggregate
  const aggregate = receiptAggregateOfferRes.ok?.out.ok?.aggregate

  // Put FAKE value in table to issue final receipt via cron?
  const dealId = 1111
  console.log(`put deal on deal tracker for aggregate ${aggregate}`)
  await putDealToDealTracker(aggregate.toString(), dealId)

  // Trigger cron to update and issue receipts based on deals
  const callDealerCronRes = await fetch(`https://staging.dealer.web3.storage/cron`)
  t.true(callDealerCronRes.ok)

  // Await for `aggregate/accept` receipt
  const aggregateAcceptReceiptCid = receiptAggregateOfferRes.ok?.fx.join?.link()
  if (!aggregateAcceptReceiptCid) {
    throw new Error('aggregate/offer receipt has no effect for aggregate/accept')
  }
  console.log(`wait for aggregate/accept receipt ${aggregateAcceptReceiptCid.toString()} ...`)
  await waitForStoreOperationOkResult(
    () => receiptStoreFilecoin.get(aggregateAcceptReceiptCid),
    (res) => Boolean(res.ok)
  )

  // Only if staging we can check matching buckets for both systems
  if (stage === 'staging') {
    // Kick storefront CRON
    const callStorefrontCronRes = await fetch(`${endpoint}/storefront-cron`)
    t.true(callStorefrontCronRes.ok)

    // Await for `piece/accept` receipt
    console.log(`wait for piece/accept receipt ${pieceAcceptReceiptCid.toString()} ...`)
    await waitForStoreOperationOkResult(
      () => receiptStore.get(pieceAcceptReceiptCid),
      (res) => Boolean(res.ok)
    )
  }
})

/**
 * @param {import('ava').ExecutionContext<import('./helpers/context.js').FilecoinContext>} t
 * @param {string} content
 */
async function getPiecesByContent (t, content) {
  const item = await pollQueryTable(
    t.context.pieceDynamo.client,
    t.context.pieceDynamo.tableName,
    {
      content: {
        ComparisonOperator: 'EQ',
        AttributeValueList: [{ S: content }]
      }
    },
    {
      indexName: 'content'
    }
  )

  return item
}

/**
 * @param {string} piece 
 * @param {number} dealId 
 */
async function putDealToDealTracker (piece, dealId) {
  const region = 'us-east-2'
  const endpoint = `https://dynamodb.${region}.amazonaws.com`
  const tableName = 'staging-w3filecoin-deal-tracker-deal-store'
  const client = new DynamoDBClient({
    region,
    endpoint
  })
  const record = {
    piece,
    provider: 'f0001',
    dealId,
    expirationEpoch: Date.now() + 10e9,
    insertedAt: (new Date()).toISOString(),
    source: 'testing'
  }
  await putTableItem(client, tableName, record)
}
