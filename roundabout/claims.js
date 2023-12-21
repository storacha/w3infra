// NOTE: shim globals needed by content-claims client deps that would be present in nodejs v18.
// TODO: migrate to sst v2 and nodejs v18+
import './globals.js'
import { read } from '@web3-storage/content-claims/client'
import { asCarCid } from './piece.js'

/** 
 * @typedef {import('multiformats').UnknownLink} UnknownLink
 * @typedef {import('@ucanto/client').URI} URI
 * @typedef {import('@web3-storage/w3up-client/types').CARLink} CARLink
 * @typedef {import('@web3-storage/content-claims/client/api').Claim} Claim
 **/

/**
 * Find the set of CAR CIDs that are claimed to be equivalent to the Piece CID.
 * 
 * @param {UnknownLink} piece
 * @param {(link: UnknownLink) => Promise<Claim[]>} [fetchClaims] - returns content claims for a cid
 */
export async function findEquivalentCarCids (piece, fetchClaims = createClaimsClientForEnv()) {
  /** @type {Set<CARLink>} */
  const cids = new Set()
  const claims = await fetchClaims(piece)
  for (const claim of claims) {
    // claims will include _all_ claims about this cid, so we filter to `equals`
    if (claim.type !== 'assert/equals') {
      continue
    }
    // an equivalence claim may have the pieceCid as the content cid _or_ the equals cid
    // so check both properties for the car cid.
    const carCid = asCarCid(claim.equals) ?? asCarCid(claim.content)
    if (carCid) {
      cids.add(carCid)
    }
  }
  return cids
}

/**
 * Find the set locations claimed given CID is present.
 * 
 * @param {UnknownLink} link
 * @param {(link: UnknownLink) => Promise<Claim[]>} [fetchClaims] - returns content claims for a cid
 */
export async function findLocationsForLink (link, fetchClaims = createClaimsClientForEnv()) {
  const claims = await fetchClaims(link)
  /** @type {Set<URI>} */
  const locations = new Set()

  for (const claim of claims) {
    // claims will include _all_ claims about this cid, so we filter to `location`
    if (claim.type !== 'assert/location') {
      continue
    }

    for (const l of claim.location) {
      locations.add(l)
    }
  }
  return locations
}

/** @param {'prod' | *} env */
export function createClaimsClientForEnv (env = process.env.SST_STAGE) {
  if (env === 'prod') {
    return read
  }
  return (cid, opts) => read(cid, { serviceURL: 'https://staging.claims.web3.storage', ...opts })
}
