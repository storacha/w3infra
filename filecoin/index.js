import { GetObjectCommand, } from '@aws-sdk/client-s3'

import * as Hasher from 'fr32-sha2-256-trunc254-padded-binary-tree-multihash'
import * as Digest from 'multiformats/hashes/digest'
import { Piece } from '@web3-storage/data-segment'
import { CID } from 'multiformats/cid'
import { Assert } from '@web3-storage/content-claims/capability'
import { Aggregator } from '@web3-storage/filecoin-client'

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
    const digestBytes = new Uint8Array(36)

    // @ts-expect-error aws Readable stream types are not good
    for await (const chunk of res.Body) {
      hasher.write(chunk)
    }
    hasher.digestInto(digestBytes, 0, true)
    const digest = Digest.decode(digestBytes)
    // @ts-expect-error some properties from PieceDigest are not present in MultihashDigest
    piece = Piece.fromDigest(digest)
  } catch (/** @type {any} */ error) {
    return {
      error: new ComputePieceFailed(`failed to compute piece CID for CAR: ${cidString}`, { cause: error })
    }
  }

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

/**
 * @param {object} props
 * @param {import('@web3-storage/data-segment').PieceLink} props.piece
 * @param {import('multiformats').CID} props.content
 * @param {string} props.group
 * @param {import('@ucanto/principal/ed25519').ConnectionView<any>} props.aggregateServiceConnection
 * @param {import('@web3-storage/filecoin-client/types').InvocationConfig} props.aggregateInvocationConfig
 * @param {import('@ucanto/principal/ed25519').ConnectionView<any>} props.claimsServiceConnection
 * @param {import('./types.js').ClaimsInvocationConfig} props.claimsInvocationConfig
 */
export async function reportPieceCid ({
  piece,
  content,
  group,
  aggregateServiceConnection,
  aggregateInvocationConfig,
  claimsServiceConnection,
  claimsInvocationConfig
}) {
  // Add claim for reading
  const claimResult = await Assert.equals
    .invoke({
      issuer: claimsInvocationConfig.issuer,
      audience: claimsInvocationConfig.audience,
      with: claimsInvocationConfig.with,
      nb: {
        content,
        equals: piece
      },
      expiration: Infinity
    })
    .execute(claimsServiceConnection)
  if (claimResult.out.error) {
    return {
      error: claimResult.out.error
    }
  }

  // Add piece for aggregation
  const aggregateQueue = await Aggregator.aggregateQueue(
    aggregateInvocationConfig,
    piece,
    group,
    { connection: aggregateServiceConnection }
  )

  if (aggregateQueue.out.error) {
    return {
      error: aggregateQueue.out.error
    }
  }

  return {
    ok: {},
  }
}
