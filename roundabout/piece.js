// NOTE: shim globals needed by content-claims client deps that would be present in nodejs v18.
// TODO: migrate to sst v2 and nodejs v18+
import './globals.js'

import { read } from '@web3-storage/content-claims/client'
import * as Raw from 'multiformats/codecs/raw'

export const CAR_CODE = 0x0202

/** @see https://github.com/multiformats/multicodec/pull/331/files */
export const PIECE_V2_CODE = 0x1011

/** 
 * @typedef {import('multiformats/cid').Link} Link
 * @typedef {import('@web3-storage/w3up-client/types').CARLink} CARLink
 * @typedef {import('@web3-storage/content-claims/client/api').Claim} Claim
 **/

/**
 * Return the cid if it is a Piece CID or undefined if not
 * @param {Link} cid
 */
export function asPieceCid(cid) {
  if (cid.multihash.code === PIECE_V2_CODE && cid.code === Raw.code) {
    return cid
  }
}

/**
 * Return the cid if it is a CAR CID or undefined if not
 * @param {Link} cid
 */
export function asCarCid(cid) {
  if (cid.code === CAR_CODE) {
    return cid
  }
}

/**
 * Find the set of CAR CIDs that are claimed to be equivalent to the Piece CID
 * 
 * @param {Link} piece
 * @param {(Link) => Promise<Claim[]>} [fetchClaims]
 */
export async function findEquivalentCarCids (piece, fetchClaims = read) {
  /** @type {Set<CARLink>} */
  const cids = new Set()
  const claims = await fetchClaims(piece)
  for (const claim of claims) {
    if (claim.type !== 'assert/equals') {
      continue
    }
    const carCid = asCarCid(claim.content) ?? asCarCid(claim.equals)
    if (carCid) {
      cids.add(carCid)
    }
  }
  return cids
}
