import { PutObjectCommand } from '@aws-sdk/client-s3'
import { createDudeWhereLocator, createHashEncodedInKeyHasher, createObjectHasher, createObjectLocator } from '../lib.js'
import { encodeCAR, randomBlock } from './helpers/dag.js'
import { createBucket, createS3 } from './helpers/resources.js'

const s3 = await createS3()

export const testObjectLocator = {
  'should find object': async (/** @type {import('entail').assert} */ assert) => {
    const bucket = await createBucket(s3.client)
    const block = randomBlock()
    const car = encodeCAR(block.cid, [block])
    const key = `complete/${block.cid}.car`

    await s3.client.send(new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: car.bytes
    }))

    const locator = createObjectLocator(s3.client, bucket, r => `complete/${r}.car`)
    const location = await locator.locate(block.cid)

    assert.ok(location)
    assert.equal(location.bucket, bucket)
    assert.equal(location.key, key)
    assert.equal(location.size, car.bytes.length)
  }
}

export const testDudeWhereLocator = {
  'should find object': async (/** @type {import('entail').assert} */ assert) => {
    const [indexBucket, dataBucket] = await Promise.all([
      createBucket(s3.client),
      createBucket(s3.client)
    ])
    const block = randomBlock()
    const car = encodeCAR(block.cid, [block])
    const indexKey = `${block.cid}/${car.cid}`
    const dataKey = `${car.cid}/${car.cid}.car`

    await Promise.all([
      s3.client.send(new PutObjectCommand({
        Bucket: indexBucket,
        Key: indexKey,
        Body: new Uint8Array()
      })),
      s3.client.send(new PutObjectCommand({
        Bucket: dataBucket,
        Key: dataKey,
        Body: car.bytes
      }))
    ])

    const locator = createDudeWhereLocator(s3.client, indexBucket, dataBucket)
    const location = await locator.locate(block.cid)

    assert.ok(location)
    assert.equal(location.bucket, dataBucket)
    assert.equal(location.key, dataKey)
    assert.equal(location.size, car.bytes.length)
  }
}

export const testObjectHasher = {
  'should hash object': async (/** @type {import('entail').assert} */ assert) => {
    const bucket = await createBucket(s3.client)
    const block = randomBlock()
    const car = encodeCAR(block.cid, [block])
    const key = `complete/${block.cid}.car`

    await s3.client.send(new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: car.bytes
    }))

    const hasher = createObjectHasher()
    const link = await hasher.digest({
      client: s3.client,
      root: block.cid,
      bucket,
      key,
      size: car.bytes.length
    })
    assert.equal(link.toString(), car.cid.toString())
  }
}

export const testHashEncodedInKeyHasher = {
  'should hash object': async (/** @type {import('entail').assert} */ assert) => {
    const bucket = await createBucket(s3.client)
    const block = randomBlock()
    const car = encodeCAR(block.cid, [block])
    const key = `${car.cid}/${car.cid}.car`

    await s3.client.send(new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: new Uint8Array() // purposely incorrect to ensure hash is coming from key
    }))

    const hasher = createHashEncodedInKeyHasher()
    const link = await hasher.digest({
      client: s3.client,
      root: block.cid,
      bucket,
      key,
      size: car.bytes.length
    })
    assert.equal(link.toString(), car.cid.toString())
  }
}
