import { Client } from '@storacha/indexing-service-client'
import * as Digest from 'multiformats/hashes/digest'
import { CID } from 'multiformats/cid'
import { equals } from 'multiformats/bytes'
import { PIECE_V1_CODE, PIECE_V1_MULTIHASH, PIECE_V2_MULTIHASH, RAW_CODE } from './constants.js'

/**
 * @import { IndexingServiceClient } from '@storacha/indexing-service-client/api'
 */

/**
 * Return the cid if it is a Piece CID or undefined if not
 *
 * @param {CID} cid
 */
export function asPieceCidV2 (cid) {
  if (cid.multihash.code === PIECE_V2_MULTIHASH && cid.code === RAW_CODE) {
    return cid
  }
}

/**
 * Return the cid if it is a v1 Piece CID or undefined if not
 *
 * @param {CID} cid
 */
export function asPieceCidV1 (cid) {
  if (cid.multihash.code === PIECE_V1_MULTIHASH && cid.code === PIECE_V1_CODE) {
    return cid
  }
}

/**
 * Find the set of CIDs that are claimed to be equivalent to the Piece CID.
 * 
 * @param {CID} piece
 * @param {IndexingServiceClient} [indexingService] - returns content claims for a cid
 */
export async function findEquivalentCids (piece, indexingService = createIndexingServiceClient()) {
  /** @type {Map<string, import('multiformats').UnknownLink>} */
  const cids = new Map()

  const res = await indexingService.queryClaims({ hashes: [piece.multihash] })
  if (res.error) throw new Error('failed to query claims', { cause: res.error })

  for (const claim of res.ok.claims.values()) {
    if (claim.type !== 'assert/equals') {
      continue
    }
    // an equivalence claim may have the pieceCid as the content cid _or_ the
    // equals cid so if content equals piece, we can grab the equals, otherwise
    // content.
    let equivalentCid
    if ('digest' in claim.content) {
      equivalentCid = equals(piece.multihash.bytes, claim.content.digest)
        ? claim.equals
        // no IPLD information, use raw I guess...
        : CID.createV1(RAW_CODE, Digest.decode(claim.content.digest))
    } else {
      equivalentCid = equals(piece.multihash.bytes, claim.content.multihash.bytes)
        ? claim.equals
        : claim.content
    }
    cids.set(equivalentCid.toString(), equivalentCid)
  }
  return new Set(cids.values())
}

/** @param {'prod' | string} env */
export function createIndexingServiceClient (env = process.env.SST_STAGE) {
  return new Client(env === 'prod' ? {} : { serviceURL: 'https://staging.indexer.storacha.network' })
}
