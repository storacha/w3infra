import { GetObjectCommand, } from '@aws-sdk/client-s3'

import * as Hasher from 'fr32-sha2-256-trunc254-padded-binary-tree-multihash'
import * as Digest from 'multiformats/hashes/digest'
import { Piece } from '@web3-storage/data-segment'
import { CID } from 'multiformats/cid'

import { GetCarFailed, ComputePieceFailed } from './errors.js'

/**
 * @typedef {object} EventRecord
 * @property {string} bucketRegion
 * @property {string} bucketName
 * @property {string} key
 *
 * @typedef {import('@aws-sdk/client-s3').S3Client} S3Client
 * @typedef {import('@aws-sdk/client-dynamodb').DynamoDBClient} DynamoDBClient
 * 
 * @param {DynamoDBClient} props.dynamoClient
 * @param {string} props.pieceTableName
 */

/**
 * Create CAR side index and write it to Satnav bucket if non existing.
 *
 * @param {object} props
 * @param {EventRecord} props.record
 * @param {S3Client} props.s3Client
 */
export async function computePieceCid({
  record,
  s3Client
}) {
  const key = record.key
  // CIDs in carpark are in format `${carCid}/${carCid}.car`
  const cidString = key.split('/')[0]
  const getCmd = new GetObjectCommand({
    Bucket: record.bucketName,
    Key: key,
  })
  let res
  try {
    res = await s3Client.send(getCmd)
    if (!res.Body) throw new Error('missing body')
  } catch (err) {
    return {
      error: new GetCarFailed(`failed to get CAR: ${record.bucketName}/${key}`, { cause: err })
    }
  }

  let piece
  try {
    const hasher = Hasher.create()

    // @ts-expect-error aws Readable stream types are not good
    for await (const chunk of res.Body) {
      hasher.write(chunk)
    }

    // ⚠️ Because digest size will dependen on the payload (padding)
    // we have to determine number of bytes needed after we're done
    // writing payload
    const digest = new Uint8Array(hasher.multihashByteLength())
    hasher.digestInto(digest, 0, true)

    // There's no GC (yet) in WASM so you should free up
    // memory manually once you're done.
    hasher.free()
    const multihashDigest = Digest.decode(digest)
    // @ts-expect-error some properties from PieceDigest are not present in MultihashDigest
    piece = Piece.fromDigest(multihashDigest)
  } catch (/** @type {any} */ error) {
    return {
      error: new ComputePieceFailed(`failed to compute piece CID for CAR: ${cidString}`, { cause: error })
    }
  }

  return {
    ok: {
      content: CID.parse(cidString),
      piece: piece.link
    },
  }
}
