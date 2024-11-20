/**
 * Insert into inclusion store did not result in an invocation that succeeded.
 * 
 * 1. Find pieces pending deals.
 * 2. Verify piece/accept receipt does not exist (validate it is missing).
 * 3. Query inclusion store for inclusion proof (validate it should exist).
 * 4. Invoke piece/accept on aggregator.
 * 
 * Required env:
 * STAGE - prod or staging
 * PRIVATE_KEY - w3up service private key
 * AGGREGATOR_PRIVATE_KEY - aggregator service private key
 */
import * as DID from '@ipld/dag-ucan/did'
import * as StorefrontCaps from '@web3-storage/capabilities/filecoin/storefront'
import { Storefront, Aggregator } from '@web3-storage/filecoin-client'
import { handlePieceMessage } from '@web3-storage/filecoin-api/aggregator/events'
import { GetItemCommand, PutItemCommand, QueryCommand } from '@aws-sdk/client-dynamodb'
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb'
import { ListObjectsV2Command, DeleteObjectCommand } from '@aws-sdk/client-s3'
import { Piece } from '@web3-storage/data-segment'
import map from 'p-map'
import retry from 'p-retry'
import dotenv from 'dotenv'
import { getServiceSigner } from '../filecoin/service.js'
import { createPieceTable } from '../filecoin/store/piece.js'
import { createReceiptStore } from '../filecoin/store/receipt.js'
import { getAggregatorServiceDID, getInclusionTableName, getInvocationBucketName, getPieceTableName, getAggregatorPieceTableName, getRegion, getServiceDID, getStage, getWorkflowBucketName } from './lib.js'
import { mustGetEnv } from '../lib/env.js'
import { getDynamoClient } from '../lib/aws/dynamo.js'
import { getS3Client } from '../lib/aws/s3.js'

dotenv.config({ path: ['.env', '../.env'] })

/** @typedef {import('@web3-storage/upload-api').PieceLink} PieceLink */

const CONCURRENCY = 50
const threeDays = 1000 * 60 * 60 * 24 * 3

export const redrivePieceAccept = async () => {
  const stage = getStage()
  const region = getRegion(stage)

  const pieceTableName = getPieceTableName(stage)
  const pieceStore = createPieceTable(region, pieceTableName)
  const inclusionTableName = getInclusionTableName(stage)
  const inclusionStore = createInclusionStore(region, inclusionTableName)
  const invocationBucketName = getInvocationBucketName(stage)
  const workflowBucketName = getWorkflowBucketName(stage)
  const aggregatorPieceTableName = getAggregatorPieceTableName(stage)
  const aggregatorPieceStore = createAggregatorPieceStore(region, aggregatorPieceTableName)

  const s3 = getS3Client({ region })
  const receiptStore = {
    ...createReceiptStore(region, invocationBucketName, workflowBucketName),
    /** @param {import('multiformats').Link} task */
    async remove (task) {
      const cmd = new ListObjectsV2Command({
        Bucket: invocationBucketName,
        Prefix: `${task}/`
      })

      try {
        const listRes = await s3.send(cmd)
        for (const item of listRes.Contents ?? []) {
          const cmd = new DeleteObjectCommand({
            Bucket: invocationBucketName,
            Key: item.Key
          })
          await s3.send(cmd)
          console.log('removing:', item.Key)
        }
      } catch (err) {
        return { error: err }
      }
      return { ok: {} }
    }
  }

  const { PRIVATE_KEY, AGGREGATOR_PRIVATE_KEY } = getEnv()
  const servicePrincipal = DID.parse(getServiceDID(stage))
  const serviceSigner = getServiceSigner({ privateKey: PRIVATE_KEY }).withDID(servicePrincipal.did())

  const aggregatorServicePrincipal = DID.parse(getAggregatorServiceDID(stage))
  const aggregatorServiceSigner = getServiceSigner({ privateKey: AGGREGATOR_PRIVATE_KEY }).withDID(aggregatorServicePrincipal.did())

  let total = 0
  // query submitted status pieces (they are orderd by oldest timestamp with sort key)
  /** @type {string|undefined} */
  let cursor
  do {
    const submittedPieces = await pieceStore.query({ status: 'submitted' }, { cursor })
    if (submittedPieces.error) {
      throw new Error('failed to get submitted pieces', { cause: submittedPieces.error })
    }

    const submittedPiecesEntries = submittedPieces.ok.results.entries()
    // const submittedPiecesEntries = [...submittedPieces.ok.results.entries()].slice(0, 1)

    await map(submittedPiecesEntries, async ([i, record]) => {
      total++
      const pfx = `${record.piece}:`
      // console.log(`${pfx} ${record.insertedAt} (${(i + 1).toLocaleString()} of ${submittedPieces.ok.results.length.toLocaleString()} total: ${total})`)

      if (new Date(record.insertedAt).getTime() > Date.now() - threeDays) {
        return console.log(`ignoring recent piece ${record.insertedAt}: ${record.piece}`)
      }

      const filecoinSubmitInvocation = await StorefrontCaps.filecoinSubmit
        .invoke({
          issuer: serviceSigner,
          audience: serviceSigner,
          with: serviceSigner.did(),
          nb: {
            piece: record.piece,
            content: record.content,
          },
          expiration: Infinity,
        })
        .delegate()
      // console.log(`${pfx} filecoin/submit: ${filecoinSubmitInvocation.link()}`)

      await retry(async () => {
        const filecoinSubmitReceiptGet = await receiptStore.get(filecoinSubmitInvocation.link())
        if (filecoinSubmitReceiptGet.error) {
          const filecoinSubmitInvocation2 = await Storefront.filecoinSubmit({
            issuer: serviceSigner,
            audience: serviceSigner,
            with: serviceSigner.did(),
          }, record.content, record.piece)
          if (filecoinSubmitInvocation2.out.error) {
            throw new Error(`${pfx} failed filecoin/submit invocation: ${record.piece}`, { cause: filecoinSubmitInvocation2.out.error })
          }
          return console.log(`${pfx} ✅ filecoin/submit invoked`)
        }
        if (filecoinSubmitReceiptGet.ok.out.error) {
          // Remove receipts for this invocation (we cannot make a new one
          // with a nonce because effect links in UCAN 0.9 are the invocation
          // not the task, so include the nonce)
          const filecoinSubmitReceiptRemove = await receiptStore.remove(filecoinSubmitInvocation.link())
          if (filecoinSubmitReceiptRemove.error) {
            throw new Error(`failed to remove receipts for ${filecoinSubmitInvocation.link()}`, { cause: filecoinSubmitReceiptRemove.error })
          }

          const filecoinSubmitInvocation2 = await Storefront.filecoinSubmit({
            issuer: serviceSigner,
            audience: serviceSigner,
            with: serviceSigner.did(),
          }, record.content, record.piece)
          if (filecoinSubmitInvocation2.out.error) {
            throw new Error(`${pfx} failed filecoin/submit invocation: ${record.piece}`, { cause: filecoinSubmitInvocation2.out.error })
          }

          const filecoinSubmitReceiptGet2 = await receiptStore.get(filecoinSubmitInvocation.link())
          if (!filecoinSubmitReceiptGet2.ok) {
            throw new Error(`receipt does not exist even after filecoin/submit invocation: ${record.piece}`)
          }
          if (!filecoinSubmitReceiptGet2.ok.out.ok) {
            throw new Error(`receipt is not success after filecoin/submit invocation: ${record.piece}`)
          }
          return console.log(`${pfx} ✅ filecoin/submit receipt issued`)
        }
        if (!filecoinSubmitReceiptGet.ok.fx.join) {
          return console.error(`${pfx} missing filecoin/submit next task`)
        }
        // console.log(`${pfx} piece/offer: ${filecoinSubmitReceiptGet.ok.fx.join}`)

        const pieceOfferReceiptGet = await receiptStore.get(filecoinSubmitReceiptGet.ok.fx.join.link())
        if (pieceOfferReceiptGet.error) {
          return console.error(`${pfx} missing piece/offer receipt`)
        }
        if (pieceOfferReceiptGet.ok.out.error) {
          // Remove receipts for this invocation (we cannot make a new one
          // with a nonce because effect links in UCAN 0.9 are the invocation
          // not the task, so include the nonce)
          const pieceOfferReceiptRemove = await receiptStore.remove(filecoinSubmitReceiptGet.ok.fx.join.link())
          if (pieceOfferReceiptRemove.error) {
            throw new Error(`failed to remove receipts for ${filecoinSubmitReceiptGet.ok.fx.join}`, { cause: pieceOfferReceiptRemove.error })
          }

          const pieceOfferInvocation = await Aggregator.pieceOffer({
            issuer: aggregatorServiceSigner,
            with: aggregatorServiceSigner.did()
          }, record.piece, record.group)
          if (pieceOfferInvocation.out.error) {
            throw new Error(`failed piece/offer invocation: ${record.piece}`, { cause: pieceOfferInvocation.out.error })
          }

          const pieceOfferReceiptGet2 = await receiptStore.get(filecoinSubmitReceiptGet.ok.fx.join.link())
          if (!pieceOfferReceiptGet2.ok) {
            throw new Error(`receipt does not exist even after piece/offer invocation: ${record.piece}`)
          }
          if (!pieceOfferReceiptGet2.ok.out.ok) {
            throw new Error(`receipt is not success after piece/offer invocation: ${record.piece}`)
          }
          return console.log(`${pfx} ✅ piece/offer receipt issued`)
        }
        if (!pieceOfferReceiptGet.ok.fx.join) {
          return console.error(`${pfx} missing piece/offer next task`)
        }
        // console.log(`${pfx} piece/accept: ${pieceOfferReceiptGet.ok.fx.join}`)

        const pieceAcceptReceiptGet = await receiptStore.get(pieceOfferReceiptGet.ok.fx.join.link())
        if (pieceAcceptReceiptGet.ok && pieceAcceptReceiptGet.ok.out.ok) {
          // console.log(`${pfx} ⏭️ receipt exists - skipping`)
          return
        }

        // do we even have it in the store?
        const pieceStoreHas = await aggregatorPieceStore.has(record.piece, record.group)
        if (pieceStoreHas.error) {
          throw new Error(`failed to determine if aggregator piece store has the piece: ${record.piece}`)
        }
        if (!pieceStoreHas.ok) {
          // @ts-expect-error not the real piece store from w3filecoin-infra
          const res = await handlePieceMessage({ pieceStore: aggregatorPieceStore }, record)
          if (res.error) {
            throw new Error(`failed to add to piece store: ${record.piece}`, { cause: res.error })
          }
          return console.log(`${pfx} ✅ added to aggregator piece store`)
        }

        const inclusionList = await inclusionStore.list(record.piece)
        if (inclusionList.error) {
          throw new Error(`failed to list inclusions ${record.piece}`, { cause: inclusionList.error })
        }
        if (!inclusionList.ok.length) {
          console.warn(`${pfx} no inclusion (${record.insertedAt})`)
          return
        }

        for (const inclusion of inclusionList.ok) {
          // console.log(`${pfx} aggregate: ${inclusion.aggregate} group: ${inclusion.group}`)

          // if there was a receipt, and it was an error...
          if (pieceAcceptReceiptGet.ok?.out.error) {
            // Remove receipts for this invocation (we cannot make a new one
            // with a nonce because effect links in UCAN 0.9 are the invocation
            // not the task, so include the nonce)
            const pieceAcceptReceiptRemove = await receiptStore.remove(pieceOfferReceiptGet.ok.fx.join.link())
            if (pieceAcceptReceiptRemove.error) {
              throw new Error(`failed to remove receipts for ${pieceOfferReceiptGet.ok.fx.join}`, { cause: pieceAcceptReceiptRemove.error })
            }
          }

          const pieceAcceptInvocation = await Aggregator.pieceAccept({
            issuer: aggregatorServiceSigner,
            with: aggregatorServiceSigner.did()
          }, record.piece, inclusion.group)
          if (pieceAcceptInvocation.out.error) {
            throw new Error(`failed piece/accept invocation: ${record.piece}`, { cause: pieceAcceptInvocation.out.error })
          }

          const pieceAcceptReceiptGet2 = await receiptStore.get(pieceOfferReceiptGet.ok.fx.join.link())
          if (!pieceAcceptReceiptGet2.ok) {
            throw new Error(`receipt does not exist even after piece/accept invocation: ${record.piece}`)
          }
          if (!pieceAcceptReceiptGet2.ok.out.ok) {
            throw new Error(`receipt is not success after piece/accept invocation: ${record.piece}`)
          }

          console.log(`${pfx} ✅ piece/accept receipt issued`)
        }
      }, { onFailedAttempt: err => console.warn(pfx, err) })
    }, { concurrency: CONCURRENCY })

    // break
    cursor = submittedPieces.ok.cursor
  } while (cursor)

  console.log('Done!')
}

const getEnv = () => ({
  PRIVATE_KEY: mustGetEnv('PRIVATE_KEY'),
  AGGREGATOR_PRIVATE_KEY: mustGetEnv('AGGREGATOR_PRIVATE_KEY')
})

/**
 * @param {string} region
 * @param {string} tableName
 */
const createAggregatorPieceStore = (region, tableName) => {
  const dynamo = getDynamoClient({ region })
  return {
    /**
     * @param {PieceLink} piece
     * @param {string} group
     * @returns {Promise<import('@ucanto/interface').Result<boolean, import('@ucanto/interface').Failure>>}
     */
    async has (piece, group) {
      const cmd = new GetItemCommand({
        TableName: tableName,
        Key: marshall({ piece: piece.toString(), group }),
      })
      let res
      try {
        res = await dynamo.send(cmd)
      } catch (/** @type {any} */ err) {
        return { error: err }
      }

      return { ok: Boolean(res.Item) }
    },
    /**
     * @param {import('@web3-storage/filecoin-api/aggregator/api').PieceRecord} record
     * @returns {Promise<import('@ucanto/interface').Result<{}, import('@ucanto/interface').Failure>>}
     */
    async put (record) {
      const cmd = new PutItemCommand({
        TableName: tableName,
        Item: marshall({
          piece: record.piece.toString(),
          stat: record.status === 'offered' ? 0 : 1,
          group: record.group,
          insertedAt: record.insertedAt,
          updatedAt: record.updatedAt,
        }, {
          removeUndefinedValues: true
        }),
      })

      try {
        await dynamo.send(cmd)
      } catch (/** @type {any} */ err) {
        return { error: err }
      }

      return { ok: {} }
    }
  }
}

/**
 * @param {string} region
 * @param {string} tableName
 */
const createInclusionStore = (region, tableName) => {
  const dynamo = getDynamoClient({ region })
  return {
    /**
     * @param {PieceLink} piece
     * @returns {Promise<import('@ucanto/interface').Result<Array<{ aggregate: PieceLink, group: string }>, import('@ucanto/interface').Failure>>}
     */
    async list (piece) {
      try {
        const cmd = new QueryCommand({
          TableName: tableName,
          IndexName: 'indexPiece',
          KeyConditions: {
            piece: {
              ComparisonOperator: 'EQ',
              AttributeValueList: [{ S: piece.toString() }]
            }
          }
        })
        const res = await dynamo.send(cmd)
        /** @type {Array<{ aggregate: PieceLink, group: string }>} */
        const records = []
        for (const item of res.Items ?? []) {
          const raw = unmarshall(item)
          records.push({
            aggregate: Piece.fromString(raw.aggregate).link,
            group: raw.group
          })
        }
        return { ok: records }
      } catch (/** @type {any} */ err) {
        return { error: err }
      }
    }
  }
}
