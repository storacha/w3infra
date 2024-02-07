import { test } from './helpers/context.js'
import { CID } from 'multiformats/cid'
import * as Raw from 'multiformats/codecs/raw'
import { sha256 } from 'multiformats/hashes/sha2'
import * as Digest from 'multiformats/hashes/digest'
import { Piece, MIN_PAYLOAD_SIZE } from '@web3-storage/data-segment'
import { findEquivalentCids, asCarCid, asPieceCidV1, asPieceCidV2, CAR_CODE } from '../piece.js'

test('findEquivalentCids', async t => {
  const bytes = new Uint8Array(MIN_PAYLOAD_SIZE)
  const pieceCid = Piece.fromPayload(bytes).link
  const carCid = CID.createV1(CAR_CODE, sha256.digest(bytes))
  const rawCid = CID.createV1(Raw.code, sha256.digest(bytes))
  const carSet = await findEquivalentCids(pieceCid, async () => {
    return [
      { type: 'assert/equals', content: pieceCid, equals: carCid }, // yes! is equivalent carCid
      { type: 'assert/equals', content: carCid, equals: pieceCid }, // no: is duplicate
      { type: 'assert/equals', content: pieceCid, equals: rawCid }, // yes! pieceCId mapped to rawCid
      { type: 'assert/location', content: pieceCid, location: `ipfs://${carCid}` }, // no: is not equals claim
    ]
  })
  t.is(carSet.size, 2, 'should return mapped CIDs')
  t.is([...carSet].at(0).toString(), carCid.toString())
})

test('findEquivalentCids from content-claims api', async t => {
  const pieceCid = CID.parse('bafkzcibbai3tdo4zvruj6zxo6wlt4suu3imi6to4vzmaojh4n475mdp5jcbtg')
  const carCid = CID.parse('bagbaieratdhefxxpkhkae2ovil2tcs7pfr2grvabvvoykful7k2maeepox3q')
  const carSet = await findEquivalentCids(pieceCid)
  let found
  for (const cid of carSet) {
    if (cid.toString() === carCid.toString()) {
      found = cid
      break
    }
  }
  t.assert(found)
  t.is(found.toString(), carCid.toString())
})

test('asCarCid', t => {
  const bytes = new Uint8Array(MIN_PAYLOAD_SIZE)
  const pieceCid = Piece.fromPayload(bytes).link
  const carCid = CID.createV1(CAR_CODE, sha256.digest(bytes)) 
  const rawCid = CID.createV1(Raw.code, sha256.digest(bytes))
  t.is(asCarCid(pieceCid), undefined)
  t.is(asCarCid(carCid), carCid)
  t.is(asCarCid(rawCid), undefined)
})

test('asPieceCidv2', t => {
  const bytes = new Uint8Array(MIN_PAYLOAD_SIZE)
  const piece = Piece.fromPayload(bytes)
  const pieceCidV2 = piece.link
  const pieceCidV1 = CID.createV1(Piece.FilCommitmentUnsealed, Digest.create(Piece.Sha256Trunc254Padded, piece.root))
  const carCid = CID.createV1(CAR_CODE, sha256.digest(bytes)) 
  const rawCid = CID.createV1(Raw.code, sha256.digest(bytes))
  t.is(asPieceCidV2(pieceCidV1), undefined)
  t.is(asPieceCidV2(pieceCidV2), pieceCidV2)
  t.is(asPieceCidV2(carCid), undefined)
  t.is(asPieceCidV2(rawCid), undefined)
})

test('asPieceCidv1', t => {
  const bytes = new Uint8Array(MIN_PAYLOAD_SIZE)
  const piece = Piece.fromPayload(bytes)
  const pieceCidV2 = piece.link
  const pieceCidV1 = CID.createV1(Piece.FilCommitmentUnsealed, Digest.create(Piece.Sha256Trunc254Padded, piece.root))
  const carCid = CID.createV1(CAR_CODE, sha256.digest(bytes)) 
  const rawCid = CID.createV1(Raw.code, sha256.digest(bytes))
  t.is(asPieceCidV1(pieceCidV1), pieceCidV1)
  t.is(asPieceCidV1(pieceCidV2),undefined)
  t.is(asPieceCidV1(carCid), undefined)
  t.is(asPieceCidV1(rawCid), undefined)
})
