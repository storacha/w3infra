import { testFilecoin as test, withCauseLog } from './helpers/context.js'
import { fetch } from '@web-std/fetch'
import pWaitFor from 'p-wait-for'
import { isDelegation } from '@ucanto/core'
import * as CAR from '@ucanto/transport/car'
import { Storefront } from '@storacha/filecoin-client'
import * as FilecoinCapabilities from '@storacha/capabilities/filecoin'
import * as Link from 'multiformats/link'
import * as raw from 'multiformats/codecs/raw'
import * as AgentStore from '../upload-api/stores/agent.js'
import {
  getApiEndpoint,
  getAwsBucketClient,
  getRoundaboutEndpoint,
  getDynamoDb,
  getAwsRegion,
  getBucketName
} from './helpers/deployment.js'
import { setupNewClient } from './helpers/up-client.js'
import { getClientConfig } from './helpers/fil-client.js'
import { randomFile } from './helpers/random.js'
import { pollQueryTable } from './helpers/table.js'
import { waitForStoreOperationOkResult } from './helpers/store.js'

/**
 * @typedef {import('multiformats').UnknownLink} UnknownLink
 * @typedef {import('@web3-storage/data-segment').PieceLink} PieceLink
 */

test.before(t => {
  t.context = {
    pieceDynamo: getDynamoDb('piece-v2'),
  }
})

test('w3filecoin integration flow', withCauseLog(async t => {
  const s3Client = getAwsBucketClient()
  // const s3ClientFilecoin = getAwsBucketClient('us-east-2')

  // setup client connection config for w3filecoin pipeline entrypoint, i.e. API Storefront relies on
  const { invocationConfig, connection } = await getClientConfig(new URL(getApiEndpoint()))

  // setup w3up client
  const { client } = await setupNewClient()
  const spaceDid = client.currentSpace()?.did()
  if (!spaceDid) {
    throw new Error('Testing space DID must be set')
  }
  
  console.log('uploading 4 files')
  const uploads = await Promise.all(Array.from({ length: 4 }).map(async () => {
      const file = await randomFile(1024)

      /** @type {Array<{ content: UnknownLink, piece: PieceLink }>} */
      const uploadFiles = []

      // TODO: New client should use blob directly and this should be the same and work :)
      // Upload new file
      await client.uploadFile(file, {
        onShardStored: (meta) => {
          const content = Link.create(raw.code, meta.cid.multihash)
          if (!meta.piece) throw new Error('missing piece link in upload meta')
          uploadFiles.push({
            content,
            piece: meta.piece
          })
          console.log(`file written with root: ${content}, shard: ${meta.cid}, piece: ${meta.piece}`)
        }
      })
      t.is(uploadFiles.length, 1)
      return uploadFiles[0]
    }
  ))

  // Check filecoin pieces computed after leaving queue
  // Bucket event given client is not invoking this
  await Promise.all(uploads.map(async (upload) => {
    const pieces = await getPiecesByContent(t, upload.content.toString())
    t.assert(pieces)
    t.is(pieces?.length, 1)
    t.truthy(pieces?.[0].piece)
    t.is(pieces?.[0].piece, upload.piece.toString())
  }))

  console.log('pieces in table')

  // we only care about one making its way to the finish, as based on timings an individual piece may need to wait for a new batch
  await Promise.race(uploads.map(async testUpload => {
    // Check roundabout can redirect from pieceCid to signed bucket url for car
    const roundaboutEndpoint = await getRoundaboutEndpoint()
    const roundaboutUrl = new URL(testUpload.piece.toString(), roundaboutEndpoint)
    await pWaitFor(async () => {
      try {
        const res = await fetch(roundaboutUrl, {
          method: 'HEAD',
          redirect: 'manual'
        })
        // do not assume blob hash is in redirect URL, just ensure roundabout
        // returns a redirect status (signalling it found the piece).
        return res.status === 302
      } catch {}
      return false
    }, {
      interval: 100,
    })
    console.log('roundabout redirected from piece to blob', roundaboutUrl.toString())

    // Invoke `filecoin/offer`
    console.log(`invoke 'filecoin/offer' for piece ${testUpload.piece.toString()} (${testUpload.content})`)
    const filecoinOfferRes = await Storefront.filecoinOffer(invocationConfig, testUpload.content, testUpload.piece, { connection })
    if (filecoinOfferRes.out.error) {
      throw new Error(`failed ${FilecoinCapabilities.offer.can} invocation`, { cause: filecoinOfferRes.out.error })
    }
    t.truthy(filecoinOfferRes.fx.join)
    t.is(filecoinOfferRes.fx.fork.length, 1)

    const filecoinSubmitReceiptCid = filecoinOfferRes.fx.fork[0]
    const filecoinAcceptReceiptCid = filecoinOfferRes.fx.join?.link()
    console.log('filecoin/offer effects')
    console.log('filecoin/offer fork (filecoin/submit)', filecoinSubmitReceiptCid)
    console.log('filecoin/offer join (filecoin/accept)', filecoinAcceptReceiptCid)
    if (!filecoinAcceptReceiptCid) {
      return t.fail('filecoin/offer receipt has no effect for filecoin/accept')
    }

    // Get receipt from endpoint
    const filecoinOfferInvCid = filecoinOfferRes.ran.link()
    const workflowWithReceiptResponse = await fetch(
      `${getApiEndpoint()}/receipt/${filecoinOfferInvCid.toString()}`,
      {
        redirect: 'manual'
      }
    )
    t.is(workflowWithReceiptResponse.status, 302)
    const workflowLocation = workflowWithReceiptResponse.headers.get('location')
    if (!workflowLocation) {
      return t.fail(`no workflow with receipt for task: ${filecoinOfferInvCid}`)
    }

    const workflowWithReceiptResponseAfterRedirect = await fetch(workflowLocation)
    // Get receipt from Message Archive
    const agentMessageBytes = new Uint8Array((await workflowWithReceiptResponseAfterRedirect.arrayBuffer()))
    const agentMessage = await CAR.request.decode({
      body: agentMessageBytes,
      headers: {},
    })
    const receipt = agentMessage.receipts.get(filecoinOfferInvCid.toString())
    if (!receipt) {
      return t.fail(`receipt not found for task: ${filecoinOfferInvCid}`)
    }
    // Receipt matches what we received when invoked
    t.truthy(receipt.ran.link().equals(filecoinOfferInvCid))
    if (!receipt.fx.join) {
      return t.fail(`receipt missing join effect: ${filecoinOfferInvCid}`)
    }

    const joinLink = isDelegation(receipt.fx.join)
      ? receipt.fx.join.cid
      : receipt.fx.join
    t.truthy(joinLink.equals(filecoinAcceptReceiptCid))

    const forkLink = isDelegation(receipt.fx.fork[0])
      ? receipt.fx.fork[0].cid
      : receipt.fx.fork[0]
    t.truthy(forkLink.equals(filecoinSubmitReceiptCid))

    // Verify receipt chain
    console.log(`wait for receipt chain...`)
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
    // const receiptStoreFilecoin = useReceiptStore(s3ClientFilecoin, 'invocation-store-staging-0', 'workflow-store-staging-0')

    // Await for `filecoin/submit` receipt
    console.log(`wait for filecoin/submit receipt ${filecoinSubmitReceiptCid.toString()} ...`)
    const receiptFilecoinSubmitRes = await waitForStoreOperationOkResult(
      () => agentStore.receipts.get(filecoinSubmitReceiptCid.link()),
      (res) => Boolean(res.ok)
    )
    
    // Await for `piece/offer` receipt
    const pieceOfferReceiptCid = receiptFilecoinSubmitRes.ok?.fx.join?.link()
    if (!pieceOfferReceiptCid) {
      throw new Error('filecoin/submit receipt has no effect for piece/offer')
    }


    // TODO: This code is disabled as it tests running, real, shared infrastructure
    // that is maintained outside of this repo, and could fail for reasons unrelated
    // to what's happening in this repo
    // To the extent we want a kitchen-sink test, it should happen with
    // infra deployed specifically for the test, with predictable performance
    // Alternatively, if we're simply testing interactions with expected behavior
    // for w3-filecoininfra, we should use a mocked version of the service with
    // predictable responses. 
    // This rest of this test is disabled until one of these solutions is put
    // in place

    // console.log(`wait for piece/offer receipt ${pieceOfferReceiptCid.toString()} ...`)
    // await waitForStoreOperationOkResult(
    //   () => receiptStoreFilecoin.get(pieceOfferReceiptCid),
    //   (res) => Boolean(res.ok)
    // )
    // // Await for `piece/accept` receipt
    // const pieceAcceptReceiptCid = receiptPieceOfferRes.ok?.fx.join?.link()
    // if (!pieceAcceptReceiptCid) {
    //   throw new Error('piece/offer receipt has no effect for piece/accept')
    // }
    // console.log(`wait for piece/accept receipt ${pieceAcceptReceiptCid.toString()} ...`)
    // const receiptPieceAcceptRes = await waitForStoreOperationOkResult(
    //   () => receiptStoreFilecoin.get(pieceAcceptReceiptCid),
    //   (res) => Boolean(res.ok)
    // )

    // // Await for `aggregate/offer` receipt
    // const aggregateOfferReceiptCid = receiptPieceAcceptRes.ok?.fx.join?.link()
    // if (!aggregateOfferReceiptCid) {
    //   throw new Error('piece/accept receipt has no effect for aggregate/offer')
    // }
    // console.log(`wait for aggregate/offer receipt ${aggregateOfferReceiptCid.toString()} ...`)
    // const receiptAggregateOfferRes = await waitForStoreOperationOkResult(
    //   () => receiptStoreFilecoin.get(aggregateOfferReceiptCid),
    //   (res) => Boolean(res.ok)
    // )

    // // @ts-ignore no type for aggregate
    // const aggregate = receiptAggregateOfferRes.ok?.out.ok?.aggregate

    // // Put FAKE value in table to issue final receipt via cron?
    // const dealId = 1111
    // console.log(`put deal on deal tracker for aggregate ${aggregate}`)
    // await putDealToDealTracker(aggregate.toString(), dealId)

    // // Await for `aggregate/accept` receipt
    // const aggregateAcceptReceiptCid = receiptAggregateOfferRes.ok?.fx.join?.link()
    // if (!aggregateAcceptReceiptCid) {
    //   throw new Error('aggregate/offer receipt has no effect for aggregate/accept')
    // }
    // console.log(`wait for aggregate/accept receipt ${aggregateAcceptReceiptCid.toString()} ...`)
    // await waitForStoreOperationOkResult(
    //   async () => {
    //     // Trigger cron to update and issue receipts based on deals
    //     await pRetry(async () => {
    //       const url = 'https://staging.dealer.web3.storage/cron'
    //       const res = await fetch(url)
    //       if (!res.ok) throw new Error(`failed request to ${url}: ${res.status}`)
    //     }, { onFailedAttempt: console.warn })

    //     return receiptStoreFilecoin.get(aggregateAcceptReceiptCid)
    //     // return agentStoreFilecoin.receipts.get(aggregateAcceptReceiptCid)
    //   },
    //   (res) => Boolean(res.ok)
    // ) 
  }))
}))

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

// /**
//  * @param {string} piece 
//  * @param {number} dealId 
//  */
// async function putDealToDealTracker (piece, dealId) {
//   const region = 'us-east-2'
//   const endpoint = `https://dynamodb.${region}.amazonaws.com`
//   const tableName = 'staging-w3filecoin-deal-tracker-deal-store-v1'
//   const client = new DynamoDBClient({
//     region,
//     endpoint
//   })
//   const record = {
//     piece,
//     provider: 'f0001',
//     dealId,
//     expirationEpoch: Date.now() + 10e9,
//     insertedAt: (new Date()).toISOString(),
//     source: 'testing'
//   }
//   await putTableItem(client, tableName, record)
// }
