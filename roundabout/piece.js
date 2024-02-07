// NOTE: shim globals needed by content-claims client deps that would be present in nodejs v18.
// TODO: migrate to sst v2 and nodejs v18+
import './globals.js'

import { read } from '@web3-storage/content-claims/client'
import * as Raw from 'multiformats/codecs/raw'

/** https://github.com/multiformats/multicodec/blob/master/table.csv#L140 */
export const CAR_CODE = 0x02_02

/** https://github.com/multiformats/multicodec/blob/master/table.csv#L520 */
export const PIECE_V1_CODE = 0xf1_01

/** https://github.com/multiformats/multicodec/blob/master/table.csv#L151 */
export const PIECE_V1_MULTIHASH = 0x10_12

/** https://github.com/multiformats/multicodec/pull/331/files */
export const PIECE_V2_MULTIHASH = 0x10_11

/** 
 * @typedef {import('multiformats/cid').CID} CID
 * @typedef {import('@web3-storage/content-claims/client/api').Claim} Claim
 **/

/**
 * Return the cid if it is a Piece CID or undefined if not
 *
 * @param {CID} cid
 */
export function asPieceCidV2 (cid) {
  if (cid.multihash.code === PIECE_V2_MULTIHASH && cid.code === Raw.code) {
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
 * Return the cid if it is a CAR CID or undefined if not
 *
 * @param {CID} cid
 */
export function asCarCid(cid) {
  if (cid.code === CAR_CODE) {
    return cid
  }
}

/**
 * Find the set of CIDs that are claimed to be equivalent to the Piece CID.
 * 
 * @param {CID} piece
 * @param {(CID) => Promise<Claim[]>} [fetchClaims] - returns content claims for a cid
 */
export async function findEquivalentCids (piece, fetchClaims = createClaimsClientForEnv()) {
  /** @type {Set<import('multiformats').UnknownLink>} */
  const cids = new Set()
  const claims = await fetchClaims(piece)
  for (const claim of claims) {
    // claims will include _all_ claims about this cid, so we filter to `equals`
    if (claim.type !== 'assert/equals') {
      continue
    }
    // an equivalence claim may have the pieceCid as the content cid _or_ the equals cid
    // so if content does not equal piece, we can grab the content. Otherwise equals
    const equivalentCid = !claim.content.equals(piece) ? claim.content : claim.equals
    cids.add(equivalentCid)
  }
  return cids
}

/** @param {'prod' | *} env */
export function createClaimsClientForEnv (env = process.env.SST_STAGE) {
  if (env === 'prod') {
    return read
  }
  return (cid, opts) => read(cid, { serviceURL: 'https://staging.claims.web3.storage', ...opts })
}
