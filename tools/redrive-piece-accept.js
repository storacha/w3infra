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
import { Aggregator } from '@web3-storage/filecoin-client'
import { QueryCommand } from '@aws-sdk/client-dynamodb'
import { Piece } from '@web3-storage/data-segment'
import map from 'p-map'
import retry, { AbortError } from 'p-retry'
import { getServiceSigner } from '../filecoin/service.js'
import { createPieceTable } from '../filecoin/store/piece.js'
import { createReceiptStore } from '../filecoin/store/receipt.js'
import { getAggregatorServiceDID, getInclusionTableName, getInvocationBucketName, getPieceTableName, getRegion, getServiceDID, getStage, getWorkflowBucketName } from './lib.js'
import { mustGetEnv } from '../lib/env.js'
import { getDynamoClient } from '../lib/aws/dynamo.js'
import { unmarshall } from '@aws-sdk/util-dynamodb'

/** @typedef {import('@web3-storage/upload-api').PieceLink} PieceLink */

const CONCURRENCY = 50

export const redrivePieceAccept = async () => {
  const stage = getStage()
  const region = getRegion(stage)

  const pieceTableName = getPieceTableName(stage)
  const pieceStore = createPieceTable(region, pieceTableName)
  const inclusionTableName = getInclusionTableName(stage)
  const inclusionStore = createInclusionStore(region, inclusionTableName)
  const invocationBucketName = getInvocationBucketName(stage)
  const workflowBucketName = getWorkflowBucketName(stage)
  const receiptStore = createReceiptStore(region, invocationBucketName, workflowBucketName)

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
    
    await map(submittedPieces.ok.results.entries(), async ([i, record]) => {
      total++
      const pfx = `${record.piece}:`
      console.log(`${pfx} ${record.insertedAt} (${(i + 1).toLocaleString()} of ${submittedPieces.ok.results.length.toLocaleString()} total: ${total})`)

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
      console.log(`${pfx} filecoin/submit: ${filecoinSubmitInvocation.link()}`)

      await retry(async () => {
        const filecoinSubmitReceiptGet = await receiptStore.get(filecoinSubmitInvocation.link())
        if (filecoinSubmitReceiptGet.error) {
          return console.error(`${pfx} missing filecoin/submit receipt`)
        }
        if (!filecoinSubmitReceiptGet.ok.fx.join) {
          return console.error(`${pfx} missing filecoin/submit next task`)
        }
        console.log(`${pfx} piece/offer: ${filecoinSubmitReceiptGet.ok.fx.join}`)

        const pieceOfferReceiptGet = await receiptStore.get(filecoinSubmitReceiptGet.ok.fx.join.link())
        if (pieceOfferReceiptGet.error) {
          return console.error(`${pfx} missing piece/offer receipt`)
        }
        if (!pieceOfferReceiptGet.ok.fx.join) {
          return console.error(`${pfx} missing piece/offer next task`)
        }
        console.log(`${pfx} piece/accept: ${pieceOfferReceiptGet.ok.fx.join}`)

        const pieceAcceptReceiptGet = await receiptStore.get(pieceOfferReceiptGet.ok.fx.join.link())
        if (pieceAcceptReceiptGet.ok) {
          console.log(`${pfx} receipt exists - skipping`)
          return
        }

        const inclusionList = await inclusionStore.list(record.piece)
        if (inclusionList.error) {
          throw new Error(`failed to list inclusions ${record.piece}`, { cause: inclusionList.error })
        }
        if (!inclusionList.ok.length) {
          console.warn(`${pfx} no inclusion for piece: ${record.piece}`)
          return
        }

        for (const inclusion of inclusionList.ok) {
          console.log(`${pfx} aggregate: ${inclusion.aggregate} group: ${inclusion.group}`)

          const pieceAcceptInvocation = await Aggregator.pieceAccept({
            issuer: aggregatorServiceSigner,
            with: aggregatorServiceSigner.did()
          }, record.piece, inclusion.group)
          if (pieceAcceptInvocation.out.error) {
            throw new Error(`failed piece/accept invocation: ${record.piece}`, { cause: pieceAcceptInvocation.out.error })
          }

          const pieceAcceptReceiptGet = await receiptStore.get(pieceOfferReceiptGet.ok.fx.join.link())
          if (!pieceAcceptReceiptGet.ok) {
            throw new Error(`receipt does not exist even after piece accept invocation: ${record.piece}`)
          }

          console.log(`${pfx} ✅ piece/accept receipt issued`)
        }
      }, { onFailedAttempt: err => console.warn(pfx, err) })
    }, { concurrency: CONCURRENCY })

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
