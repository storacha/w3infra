import {
  GetObjectCommand,
} from '@aws-sdk/client-s3'
// @@ts-expect-error needs final dep
// import * as Hasher from 'fr32-sha2-256-trunc254-padded-binary-tree-multihash'
// import * as Digest from 'multiformats/hashes/digest'
import { Piece } from '@web3-storage/data-segment'
import { CID } from 'multiformats/cid'

// import { GetCarFailed, ComputePieceFailed } from './errors.js'
import { GetCarFailed } from './errors.js'

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
 * @param {import('./types').PieceTable} props.pieceTable
 */
export async function computePieceCid({
  record,
  s3Client,
  pieceTable
}) {
  const key = record.key
  // CIDs in carpark are in format `${carCid}/${carCid}.car`
  const cidString = key.split('/')[0]

  const getCmd = new GetObjectCommand({
    Bucket: record.bucketName,
    Key: key,
  })
  const res = await s3Client.send(getCmd)
  if (!res.Body) {
    return {
      error: new GetCarFailed(`failed to get CAR file with key ${key} in bucket ${record.bucketName}`)
    }
  }

  // let piece
  // try {
  //   const hasher = Hasher.create()
  //   const digestBytes = new Uint8Array(36)

  //   // @ts-expect-error aws Readable stream types are not good
  //   for await (const chunk of res.Body.transformToWebStream()) {
  //     hasher.write(chunk)
  //   }
  //   hasher.digestInto(digestBytes, 0, true)

  //   const digest = Digest.decode(digestBytes)
  //   // @ts-expect-error some properties from PieceDigest are not present in MultihashDigest
  //   piece = Piece.fromDigest(digest)
  // } catch (/** @type {any} */ error) {
  //   return {
  //     error: new ComputePieceFailed(error.cause)
  //   }
  // }
  const piece = Piece.fromPayload(await res.Body.transformToByteArray()) 

  // Write to table
  const { ok, error } = await pieceTable.insert({
    link: CID.parse(cidString),
    piece: piece.link,
  })

  return {
    ok,
    error
  }
}
