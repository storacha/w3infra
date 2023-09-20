import { test } from './helpers/context.js'
import { CID } from 'multiformats/cid'
import * as Raw from 'multiformats/codecs/raw'
import { sha256 } from 'multiformats/hashes/sha2'
import { Piece, MIN_PAYLOAD_SIZE } from '@web3-storage/data-segment'
import { findEquivalentCarCids, asCarCid, asPieceCid, CAR_CODE } from '../piece.js'

test('findEquivalentCarCids', async t => {
  const bytes = new Uint8Array(MIN_PAYLOAD_SIZE)
  const pieceCid = Piece.fromPayload(bytes).link
  const carCid = CID.createV1(CAR_CODE, sha256.digest(bytes))
  const rawCid = CID.createV1(Raw.code, sha256.digest(bytes))
  const carSet = await findEquivalentCarCids(pieceCid, async () => {
    return [
      { type: 'assert/equals', content: pieceCid, equals: carCid }, // yes! is equivalent carCid
      { type: 'assert/equals', content: carCid, equals: pieceCid }, // no: is duplicate
      { type: 'assert/equals', content: pieceCid, equals: rawCid }, // no: pieceCId not mapped to carCid
      { type: 'assert/location', content: pieceCid, location: `ipfs://${carCid}` }, // no: is not equals claim
    ]
  })
  t.is(carSet.size, 1, 'should return 1 unique carCid')
  t.is(Array.from(carSet).at(0).toString(), carCid.toString())
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

test('asPieceCid', t => {
  const bytes = new Uint8Array(MIN_PAYLOAD_SIZE)
  const pieceCid = Piece.fromPayload(bytes).link
  const carCid = CID.createV1(CAR_CODE, sha256.digest(bytes)) 
  const rawCid = CID.createV1(Raw.code, sha256.digest(bytes))
  t.is(asPieceCid(pieceCid), pieceCid)
  t.is(asPieceCid(carCid), undefined)
  t.is(asPieceCid(rawCid), undefined)
})
