import * as StorefrontCaps from '@web3-storage/capabilities/filecoin/storefront'
import * as DID from '@ipld/dag-ucan/did'
import { Aggregate, Piece, Proof } from '@web3-storage/data-segment'
import archy from 'archy'
import dotenv from 'dotenv'
import { getServiceSigner } from '../filecoin/service.js'
import { createPieceTable } from '../filecoin/store/piece.js'
import { createReceiptStore as createFilecoinReceiptStore } from '../filecoin/store/receipt.js'
import { mustGetEnv } from '../lib/env.js'
import { getInvocationBucketName, getPieceTableName, getRegion, getServiceDID, getStage, getWorkflowBucketName } from './lib.js'

dotenv.config({ path: ['.env', '../.env'] })

/** @param {string} pieceCID */
export async function followFilecoinReceiptChain (pieceCID) {
  const PRIVATE_KEY = mustGetEnv('PRIVATE_KEY')
  const stage = getStage()
  const region = getRegion(stage)
  const pieceTableName = getPieceTableName(stage)
  const invocationBucketName = getInvocationBucketName(stage)
  const workflowBucketName = getWorkflowBucketName(stage)
  const did = DID.parse(getServiceDID(stage)).did()
  const id = getServiceSigner({ privateKey: PRIVATE_KEY }).withDID(did)
  const pieceInfo = Piece.fromString(pieceCID)
  const receiptStore = createFilecoinReceiptStore(region, invocationBucketName, workflowBucketName)
  const pieceStore = createPieceTable(region, pieceTableName)

  // Get piece in store
  const getPiece = await pieceStore.get({ piece: pieceInfo.link })
  if (getPiece.error){
    console.error(getPiece.error)
    throw new Error('could not find piece')
  }
  // Check if `filecoin/submit` receipt exists to get to know aggregate where it is included on a deal
  const filecoinSubmitInvocation = await StorefrontCaps.filecoinSubmit
    .invoke({
      issuer: id,
      audience: id,
      with: id.did(),
      nb: {
        piece: pieceInfo.link,
        content: getPiece.ok.content,
      },
      expiration: Infinity,
    })
    .delegate()

  console.log('filecoin/submit', filecoinSubmitInvocation.link())

  // Get `filecoin/submit` receipt
  const filecoinSubmitReceiptGet = await receiptStore.get(filecoinSubmitInvocation.link())
  if (filecoinSubmitReceiptGet.error) throw new Error('could not find receipt')
  console.log('out:', filecoinSubmitReceiptGet.ok.out)

  if (filecoinSubmitReceiptGet.ok.out.error) {
    throw new Error('receipt outcome error', { cause: filecoinSubmitReceiptGet.ok.out.error })
  }

  if (!filecoinSubmitReceiptGet.ok.fx.join) throw new Error('receipt without effect')
  console.log('piece/offer', filecoinSubmitReceiptGet.ok.fx.join)

  // Get `piece/offer` receipt
  const pieceOfferReceiptGet = await receiptStore.get(filecoinSubmitReceiptGet.ok.fx.join.link())
  if (pieceOfferReceiptGet.error) throw new Error('could not find receipt')
  console.log('out:', pieceOfferReceiptGet.ok.out)

  if (pieceOfferReceiptGet.ok.out.error) {
    throw new Error('receipt outcome error', { cause: pieceOfferReceiptGet.ok.out.error })
  }

  if (!pieceOfferReceiptGet.ok.fx.join) throw new Error('receipt without effect')
  console.log('piece/accept', pieceOfferReceiptGet.ok.fx.join)

  // Get `piece/accept` receipt
  const pieceAcceptReceiptGet = await receiptStore.get(pieceOfferReceiptGet.ok.fx.join.link())
  if (pieceAcceptReceiptGet.error) throw new Error(`could not find receipt: ${pieceOfferReceiptGet.ok.fx.join.link()}`)
  console.log('out:', pieceAcceptReceiptGet.ok.out)

  if (pieceAcceptReceiptGet.ok.out.error) {
    throw new Error('receipt outcome error', { cause: pieceAcceptReceiptGet.ok.out.error })
  }

  if (!pieceAcceptReceiptGet.ok.fx.join) throw new Error('receipt without effect')
  console.log('aggregate/offer', pieceAcceptReceiptGet.ok.fx.join)

  // Get `aggregate/offer` receipt
  const aggregateOfferReceiptGet = await receiptStore.get(pieceAcceptReceiptGet.ok.fx.join.link())
  if (aggregateOfferReceiptGet.error) throw new Error('could not find receipt')
  console.log('out:', aggregateOfferReceiptGet.ok.out)

  if (aggregateOfferReceiptGet.ok.out.error) {
    throw new Error('receipt outcome error', { cause: aggregateOfferReceiptGet.ok.out.error })
  }

  if (!aggregateOfferReceiptGet.ok.fx.join) throw new Error('receipt without effect')
  console.log('aggregate/accept', aggregateOfferReceiptGet.ok.fx.join)

  // Get `aggregate/accept` receipt
  const aggregateAcceptReceiptGet = await receiptStore.get(aggregateOfferReceiptGet.ok.fx.join.link())
  if (aggregateAcceptReceiptGet.error) throw new Error('could not find receipt')
  console.log('out:', aggregateAcceptReceiptGet.ok.out)

  if (aggregateAcceptReceiptGet.ok.out.error) {
    throw new Error('receipt outcome error', { cause: aggregateAcceptReceiptGet.ok.out.error })
  }

  // Get `piece/accept` receipt
  const filecoinAcceptInvocation = await StorefrontCaps.filecoinAccept
    .invoke({
      issuer: id,
      audience: id,
      with: id.did(),
      nb: {
        piece: pieceInfo.link,
        content: getPiece.ok.content,
      },
      expiration: Infinity,
    })
    .delegate()

  console.log('filecoin/accept', filecoinAcceptInvocation.link())

  const filecoinAcceptReceiptGet = await receiptStore.get(filecoinAcceptInvocation.link())
  if (filecoinAcceptReceiptGet.error) throw new Error('could not find receipt')
  console.log('out:', filecoinAcceptReceiptGet.ok.out)

  if (filecoinAcceptReceiptGet.ok.out.error) {
    throw new Error('receipt outcome error', { cause: filecoinAcceptReceiptGet.ok.out.error })
  }

  const filecoinAcceptSuccess = 
    /** @type {import('@web3-storage/upload-api').FilecoinAcceptSuccess|undefined} */
    (filecoinAcceptReceiptGet.ok.out.ok)

  if (filecoinAcceptSuccess) {
    console.log(`Piece: ${filecoinAcceptSuccess.piece}`)
    console.log(`Aggregate: ${filecoinAcceptSuccess.aggregate}`)
    console.log(`Deal: ${filecoinAcceptSuccess.aux.dataSource.dealID}`)
    console.log(`Proof:`)
    console.log(renderInclusionProof({
      proof: filecoinAcceptSuccess.inclusion.subtree,
      piece: pieceInfo,
      style: 'mini'
    }))
  }
}

const MAX_DEPTH = 63

// Adapted from https://github.com/web3-storage/data-segment/blob/e9cdcbf76232e5b92ae1d13f6cf973ec9ab657ef/src/proof.js#L62-L86
/**
 * @param {{
 *   proof: import('@web3-storage/data-segment').ProofData,
 *   piece: import('@web3-storage/data-segment').PieceView,
 *   style: 'mini'|'midi'|'maxi'
 * }} arg
 * @returns 
 */
function renderInclusionProof ({ proof, piece, style }) {
  if (Proof.depth(proof) > MAX_DEPTH) {
    throw new RangeError('merkle proofs with depths greater than 63 are not supported')
  }

  let position = BigInt(Proof.offset(proof))
  if (position >> BigInt(Proof.depth(proof)) !== 0n) {
    throw new RangeError('offset greater than width of the tree')
  }

  const { root } = piece
  /** @type {archy.Data['nodes']} */
  let nodes = []
  let top = root
  let right = 0n
  let height = piece.height

  for (const node of Proof.path(proof)) {
    right =  position & 1n
    position = position >> 1n

    const label = top === root
      ? Piece.toLink(piece).toString()
      : Piece.toLink({ root: top, height: height + 1, padding: 0n }).toString()
    const otherLabel = Piece.toLink({ root: node, height, padding: 0n }).toString()

    if (style === 'midi' || style === 'maxi') {
      if (right === 1n) {
        nodes = [{
          label: otherLabel,
          nodes: style === 'maxi' ? ['...', '...'] : []
        }, {
          label: `*${label}`,
          nodes
        }]
      } else {
        nodes = [{
          label: `*${label}`,
          nodes
        }, {
          label: otherLabel,
          nodes: style === 'maxi' ? ['...', '...'] : []
        }]
      }
    } else {
      nodes = [{ label: `*${label}`, nodes }]
    }
    top = right === 1n ? Proof.computeNode(node, top) : Proof.computeNode(top, node)
    height++
  }

  const aggregate = Aggregate.toLink({ root: top, height })
  const data = { label: aggregate.toString(), nodes }

  return archy(data)
}
