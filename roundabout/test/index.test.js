import { test } from './helpers/context.js'

import {
  PutObjectCommand,
} from '@aws-sdk/client-s3'

import { encode } from 'multiformats/block'
import { CID } from 'multiformats/cid'
import { identity } from 'multiformats/hashes/identity'
import { sha256 as hasher } from 'multiformats/hashes/sha2'
import * as pb from '@ipld/dag-pb'
import { CarBufferWriter } from '@ipld/car'

import { getSigner } from '../index.js'
import {
  parseQueryStringParameters,
  MAX_EXPIRES_IN,
  MIN_EXPIRES_IN,
  DEFAULT_EXPIRES_IN
} from '../utils.js'

import { createS3, createBucket } from './helpers/resources.js'

test.before(async t => {
  const { client } = await createS3({ port: 9000 })

  t.context.s3Client = client
})

test('can create signed url for object in bucket', async t => {
  const bucketName = await createBucket(t.context.s3Client)
  const carCid = await putCarToBucket(t.context.s3Client, bucketName)
  const expiresIn = 3 * 24 * 60 * 60 // 3 days in seconds

  const signer = getSigner(t.context.s3Client, bucketName)
  const signedUrl = await signer.getUrl(carCid, {
    expiresIn
  })

  t.assert(signedUrl)
  t.truthy(signedUrl?.includes(`X-Amz-Expires=${expiresIn}`))
  t.truthy(signedUrl?.includes(`${carCid}/${carCid}.car`))
})

test('fails to create signed url for object not in bucket', async t => {
  const bucketName = await createBucket(t.context.s3Client)
  const carCid = CID.parse('bagbaiera222226db4v4oli5fldqghzgbv5rqv3n4ykyfxk7shfr42bfnqwua')

  const signer = getSigner(t.context.s3Client, bucketName)
  const signedUrl = await signer.getUrl(carCid)

  t.falsy(signedUrl)
})

test('parses valid expires', t => {
  const queryParams = {
    expires: '900'
  }
  const param = parseQueryStringParameters(queryParams)
  t.is(param.expiresIn, parseInt(queryParams.expires))
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

/**
 * @param {import('@aws-sdk/client-s3').S3Client} s3Client
 * @param {string} bucketName 
 */
async function putCarToBucket (s3Client, bucketName) {
  // Write original car to origin bucket
  const id = await encode({
    value: pb.prepare({ Data: 'a red car on the street!' }),
    codec: pb,
    hasher: identity,
  })
  const parent = await encode({
    value: pb.prepare({ Links: [id.cid] }),
    codec: pb,
    hasher,
  })
  const car = CarBufferWriter.createWriter(Buffer.alloc(1000), {
    roots: [parent.cid],
  })
  car.write(parent)

  const Body = car.close()

  const key = `${parent.cid.toString()}/${parent.cid.toString()}.car`
  await s3Client.send(
    new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      Body,
    })
  )

  return parent.cid
}