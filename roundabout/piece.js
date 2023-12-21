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
 * @typedef {import('multiformats').UnknownLink} UnknownLink
 * @typedef {import('@web3-storage/w3up-client/types').CARLink} CARLink
 * @typedef {import('@web3-storage/content-claims/client/api').Claim} Claim
 **/

/**
 * Return the cid if it is a Piece CID or undefined if not
 *
 * @param {UnknownLink} cid
 */
export function asPieceCidV2 (cid) {
  if (cid.multihash.code === PIECE_V2_MULTIHASH && cid.code === Raw.code) {
    return cid
  }
}

/**
 * Return the cid if it is a v1 Piece CID or undefined if not
 *
 * @param {UnknownLink} cid
 */
export function asPieceCidV1 (cid) {
  if (cid.multihash.code === PIECE_V1_MULTIHASH && cid.code === PIECE_V1_CODE) {
    return cid
  }
}

/**
 * Return the cid if it is a CAR CID or undefined if not
 *
 * @param {UnknownLink} cid
 * @returns {CARLink | undefined}
 */
export function asCarCid(cid) {
  if (cid.code === CAR_CODE) {
    // @ts-expect-error types fail to understand this is CAR Link
    return cid
  }
}
