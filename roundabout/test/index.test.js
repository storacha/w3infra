import { test } from './helpers/context.js'

import { PutObjectCommand } from '@aws-sdk/client-s3'
import { encode } from 'multiformats/block'
import { CID } from 'multiformats/cid'
import { base58btc } from 'multiformats/bases/base58'
import { identity } from 'multiformats/hashes/identity'
import { sha256 as hasher } from 'multiformats/hashes/sha2'
import * as pb from '@ipld/dag-pb'
import { CarBufferWriter } from '@ipld/car'
import * as CAR from '@ucanto/transport/car'
import * as ed25519 from '@ucanto/principal/ed25519'
import { Client } from '@storacha/indexing-service-client'
import * as QueryResult from '@storacha/indexing-service-client/query-result'
import * as Claim from '@storacha/indexing-service-client/claim'
import { Assert } from '@storacha/capabilities'
import { RAW_CODE, CARPARK_DOMAIN } from '../constants.js'
import { getSigner, contentLocationResolver } from '../index.js'
import {
  parseQueryStringParameters,
  MAX_EXPIRES_IN,
  MIN_EXPIRES_IN,
  DEFAULT_EXPIRES_IN
} from '../utils.js'
import { createS3, createBucket } from './helpers/resources.js'

/** @import { URI } from '@ucanto/interface' */

test.before(async t => {
  const { client } = await createS3({ port: 9000 })
  t.context.s3Client = client
})

test('can create signed url for CAR in bucket and get it', async t => {
  const bucketName = await createBucket(t.context.s3Client)
  const carCid = await putCarToBucket(t.context.s3Client, bucketName)
  const expiresIn = 3 * 24 * 60 * 60 // 3 days in seconds
  const indexingService = new Client()

  const locateContent = contentLocationResolver({ 
    bucket: bucketName,
    s3Client: t.context.s3Client,
    expiresIn,
    indexingService,
  })

  const signedUrl = await locateContent(carCid)
  if (!signedUrl) {
    throw new Error('presigned url must be received')
  }
  t.truthy(signedUrl?.includes(`X-Amz-Expires=${expiresIn}`))
  t.truthy(signedUrl?.includes(`${carCid}/${carCid}.car`))

  const fetchResponse = await fetch(signedUrl)
  t.assert(fetchResponse.ok)
})

test('can create signed url for Blob in bucket and get it', async t => {
  const bucketName = await createBucket(t.context.s3Client)
  const blobCid = await putBlobToBucket(t.context.s3Client, bucketName)
  const encodedMultihash = base58btc.encode(blobCid.multihash.bytes)
  const expiresIn = 3 * 24 * 60 * 60 // 3 days in seconds

  const alice = await ed25519.generate()
  const space = await ed25519.generate()

  const site = await Assert.location.delegate({
    issuer: alice,
    audience: space,
    with: alice.did(),
    nb: {
      content: blobCid,
      location: [
        /** @type {URI} */
        (`http://${CARPARK_DOMAIN}/${encodedMultihash}/${encodedMultihash}.blob`)
      ]
    }
  })

  const blocks = new Map()
  for (const b of site.export()) {
    blocks.set(b.cid.toString(), b)
  }

  const result = await QueryResult.from({
    claims: [Claim.view({ root: site.cid, blocks })]
  })
  if (result.error) {
    console.error(result.error)
    return t.fail(result.error.message)
  }

  const queryArchiveRes = await QueryResult.archive(result.ok)
  if (queryArchiveRes.error) {
    console.error(result.error)
    return t.fail(queryArchiveRes.error.message)
  }

  const indexingService = new Client({
    fetch: async () => new Response(/** @type {BodyInit} */ (queryArchiveRes.ok))
  })

  const locateContent = contentLocationResolver({ 
    bucket: bucketName,
    s3Client: t.context.s3Client,
    expiresIn,
    indexingService,
  })

  const signedUrl = await locateContent(blobCid)
  if (!signedUrl) {
    throw new Error('presigned url must be received')
  }
  t.truthy(signedUrl?.includes(`X-Amz-Expires=${expiresIn}`))
  t.truthy(signedUrl?.includes(`${encodedMultihash}/${encodedMultihash}.blob`))

  const fetchResponse = await fetch(signedUrl)
  t.assert(fetchResponse.ok)
})

test('fails to fetch from signed url for object not in bucket', async t => {
  const bucketName = await createBucket(t.context.s3Client)
  const carCid = CID.parse('bagbaiera222226db4v4oli5fldqghzgbv5rqv3n4ykyfxk7shfr42bfnqwua')

  const signer = getSigner(t.context.s3Client, bucketName)
  const key = `${carCid}/${carCid}.car`
  const signedUrl = await signer.getUrl(key)

  if (!signedUrl) {
    throw new Error('presigned url must be received')
  }

  const fetchResponse = await fetch(signedUrl)
  t.falsy(fetchResponse.ok)
  t.is(fetchResponse.status, 404)
})

test('parses valid expires', t => {
  const queryParams = {
    expires: '900'
  }
  const param = parseQueryStringParameters(queryParams)
  t.is(param.expiresIn, parseInt(queryParams.expires))
})

test('parses bucket name', t => {
  const queryParams = {
    bucket: 'dagcargo'
  }
  const param = parseQueryStringParameters(queryParams)
  t.is(param.bucketName, queryParams.bucket)
})

test('fails to parse bucket name not accepted', t => {
  const queryParams = {
    bucket: 'dagcargo-not-this'
  }
  t.throws(() => parseQueryStringParameters(queryParams))
})

test('parses valid expires query parameter', t => {
  const queryParams = {
    expires: '900'
  }
  const param = parseQueryStringParameters(queryParams)
  t.is(param.expiresIn, parseInt(queryParams.expires))
})

test('defaults expires when there is no query parameter', t => {
  const queryParams = {
    nosearch: '900'
  }
  const param = parseQueryStringParameters(queryParams)
  t.is(param.expiresIn, DEFAULT_EXPIRES_IN)
})

test('fails to parse expires query parameter when not acceptable value', t => {
  const queryParamsBigger = {
    expires: `${MAX_EXPIRES_IN + 1}`
  }
  t.throws(() => parseQueryStringParameters(queryParamsBigger))

  const queryParamsSmaller = {
    expires: `${MIN_EXPIRES_IN - 1}`
  }
  t.throws(() => parseQueryStringParameters(queryParamsSmaller))
})

async function getContent () {
  const id = await encode({
    value: pb.prepare({ Data: 'a red car on the street!' }),
    codec: pb,
    hasher: identity,
  })
  return await encode({
    value: pb.prepare({ Links: [id.cid] }),
    codec: pb,
    hasher,
  })
}

/**
 * @param {import('@aws-sdk/client-s3').S3Client} s3Client
 * @param {string} bucketName 
 */
async function putBlobToBucket (s3Client, bucketName) {
  // Write original car to origin bucket
  const content = await getContent()
  const encodedMultihash = base58btc.encode(content.cid.multihash.bytes)
  const key = `${encodedMultihash}/${encodedMultihash}.blob`
  await s3Client.send(
    new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      Body: content.bytes,
    })
  )

  // Return RAW CID
  return new CID(1, RAW_CODE, content.cid.multihash, content.cid.multihash.bytes)
}

/**
 * @param {import('@aws-sdk/client-s3').S3Client} s3Client
 * @param {string} bucketName 
 */
async function putCarToBucket (s3Client, bucketName) {
  // Write original car to origin bucket
  const content = await getContent()
  const car = CarBufferWriter.createWriter(Buffer.alloc(1000).buffer, {
    roots: [content.cid],
  })
  car.write(content)

  const Body = car.close()
  const carCid = await CAR.codec.link(Body)

  const key = `${carCid.toString()}/${carCid.toString()}.car`
  await s3Client.send(
    new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      Body,
    })
  )

  return carCid
}
