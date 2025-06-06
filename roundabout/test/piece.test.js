import { test } from './helpers/context.js'
import { CID } from 'multiformats/cid'
import * as Raw from 'multiformats/codecs/raw'
import { sha256 } from 'multiformats/hashes/sha2'
import * as Digest from 'multiformats/hashes/digest'
import { Piece, MIN_PAYLOAD_SIZE } from '@web3-storage/data-segment'
import { Client } from '@storacha/indexing-service-client'
import * as QueryResult from '@storacha/indexing-service-client/query-result'
import * as Claim from '@storacha/indexing-service-client/claim'
import { Assert } from '@storacha/capabilities'
import { asCarCid } from '../utils.js'
import { CAR_CODE } from '../constants.js'
import { findEquivalentCids, asPieceCidV1, asPieceCidV2 } from '../piece.js'
import { Delegation } from '@ucanto/core'
import * as ed25519 from '@ucanto/principal/ed25519'

/**
 * @import { Ability } from '@ipld/dag-ucan'
 * @import { UnknownLink } from 'multiformats'
 */

/**
 * @template {{ content: UnknownLink }} Nb
 * @param {Ability} can
 * @param {Nb} nb
 */
const claim = async (can, nb) => {
  const signer = await ed25519.generate()
  const claim = await Delegation.delegate({
    issuer: signer,
    audience: signer,
    capabilities: [{ can, with: signer.did(), nb }]
  })
  const blocks = new Map()
  for (const b of claim.export()) {
    blocks.set(b.cid.toString(), b)
  }
  return Claim.view({ root: claim.cid, blocks })
}

test('findEquivalentCids', async t => {
  const bytes = new Uint8Array(MIN_PAYLOAD_SIZE)
  const pieceCid = Piece.fromPayload(bytes).link
  const carCid = CID.createV1(CAR_CODE, await sha256.digest(bytes))
  const rawCid = CID.createV1(Raw.code, await sha256.digest(bytes))
  const client = new Client({
    fetch: async () => {
      const result = await QueryResult.from({
        claims: [
          await claim('assert/equals', { content: pieceCid, equals: carCid }), // yes! is equivalent carCid
          await claim('assert/equals', { content: carCid, equals: pieceCid }), // no: is duplicate
          await claim('assert/equals', { content: pieceCid, equals: rawCid }), // yes! pieceCId mapped to rawCid
          await claim('assert/location', { content: pieceCid, location: [`ipfs://${carCid}`] }), // no: is not equals claim
        ]
      })
      if (result.error) {
        throw new Error('unexpected error encoding query results', { cause: result.error })
      }
    
      const archive = await QueryResult.archive(result.ok)
      t.assert(archive.ok)

      return new Response(archive.ok)
    }
  })
  const carSet = await findEquivalentCids(pieceCid, client)
  t.is(carSet.size, 2, 'should return mapped CIDs')
  t.is([...carSet].at(0)?.toString(), carCid.toString())
})

test('findEquivalentCids from indexing service', async t => {
  const pieceCid = CID.parse('bafkzcibbai3tdo4zvruj6zxo6wlt4suu3imi6to4vzmaojh4n475mdp5jcbtg')
  const carCid = CID.parse('bagbaieratdhefxxpkhkae2ovil2tcs7pfr2grvabvvoykful7k2maeepox3q')

  const alice = await ed25519.generate()
  const claim = await Assert.equals.delegate({
    issuer: alice,
    audience: alice,
    with: alice.did(),
    nb: {
      content: carCid,
      equals: pieceCid,
    }
  })

  const blocks = new Map()
  for (const b of claim.export()) {
    blocks.set(b.cid.toString(), b)
  }

  const result = await QueryResult.from({
    claims: [Claim.view({ root: claim.cid, blocks })]
  })
  if (result.error) {
    console.error(result.error)
    return t.fail(result.error.message)
  }

  const queryArchiveRes = await QueryResult.archive(result.ok)
  if (queryArchiveRes.error) {
    console.error(queryArchiveRes.error)
    return t.fail(queryArchiveRes.error.message)
  }

  const indexingService = new Client({
    fetch: async () => new Response(queryArchiveRes.ok)
  })

  const carSet = await findEquivalentCids(pieceCid, indexingService)
  let found
  for (const cid of carSet) {
    if (cid.toString() === carCid.toString()) {
      found = cid
      break
    }
  }
  t.assert(found)
  t.is(found?.toString(), carCid.toString())
})

test('asCarCid', async t => {
  const bytes = new Uint8Array(MIN_PAYLOAD_SIZE)
  const pieceCid = Piece.fromPayload(bytes).link
  const carCid = CID.createV1(CAR_CODE, await sha256.digest(bytes)) 
  const rawCid = CID.createV1(Raw.code, await sha256.digest(bytes))
  t.is(asCarCid(pieceCid), undefined)
  t.is(asCarCid(carCid), carCid)
  t.is(asCarCid(rawCid), undefined)
})

test('asPieceCidv2', async t => {
  const bytes = new Uint8Array(MIN_PAYLOAD_SIZE)
  const piece = Piece.fromPayload(bytes)
  const pieceCidV2 = piece.link
  const pieceCidV1 = CID.createV1(Piece.FilCommitmentUnsealed, Digest.create(Piece.Sha256Trunc254Padded, piece.root))
  const carCid = CID.createV1(CAR_CODE, await sha256.digest(bytes)) 
  const rawCid = CID.createV1(Raw.code, await sha256.digest(bytes))
  t.is(asPieceCidV2(pieceCidV1), undefined)
  t.is(asPieceCidV2(pieceCidV2), pieceCidV2)
  t.is(asPieceCidV2(carCid), undefined)
  t.is(asPieceCidV2(rawCid), undefined)
})

test('asPieceCidv1', async t => {
  const bytes = new Uint8Array(MIN_PAYLOAD_SIZE)
  const piece = Piece.fromPayload(bytes)
  const pieceCidV2 = piece.link
  const pieceCidV1 = CID.createV1(Piece.FilCommitmentUnsealed, Digest.create(Piece.Sha256Trunc254Padded, piece.root))
  const carCid = CID.createV1(CAR_CODE, await sha256.digest(bytes)) 
  const rawCid = CID.createV1(Raw.code, await sha256.digest(bytes))
  t.is(asPieceCidV1(pieceCidV1), pieceCidV1)
  t.is(asPieceCidV1(pieceCidV2),undefined)
  t.is(asPieceCidV1(carCid), undefined)
  t.is(asPieceCidV1(rawCid), undefined)
})
