import { testConsumerWithBucket as test } from '../helpers/context.js'

import { PutObjectCommand } from '@aws-sdk/client-s3'
import * as Signer from '@ucanto/principal/ed25519'
import * as StoreCapabilities from '@web3-storage/capabilities/store'

import { spaceMetricsTableProps } from '../../tables/index.js'
import {
  createDynamodDb,
  createS3,
  createBucket,
} from '../helpers/resources.js'
import { createDynamoTable, getItemFromTable} from '../helpers/tables.js'
import { createSpace } from '../helpers/ucanto.js'
import { randomCAR } from '../helpers/random.js'

import { updateAddSizeTotal } from '../../functions/space-metrics-store-add-size-total.js'
import { SPACE_METRICS_NAMES, STREAM_TYPE } from '../../constants.js'
import { createSpaceMetricsTable } from '../../tables/space-metrics.js'
import { createCarStore } from '../../buckets/car-store.js'

const REGION = 'us-west-2'

test.before(async t => {
  // Dynamo DB
  const {
    client: dynamo,
    endpoint: dbEndpoint
  } = await createDynamodDb({ port: 8000 })

  t.context.dbEndpoint = dbEndpoint
  t.context.dynamoClient = dynamo

  // S3
  const { client, clientOpts } = await createS3()
  t.context.s3 = client
  t.context.s3Opts = clientOpts
})

test('handles a batch of single invocation with store/add', async t => {
  const { tableName, bucketName } = await prepareResources(t.context.dynamoClient, t.context.s3)
  const uploadService = await Signer.generate()
  const alice = await Signer.generate()
  const { spaceDid } = await createSpace(alice)
  const car = await randomCAR(128)

  // Put CAR to bucket
  const putObjectCmd = new PutObjectCommand({
    Key: `${car.cid.toString()}/${car.cid.toString()}.car`,
    Bucket: bucketName,
    Body: Buffer.from(
      await car.arrayBuffer()
    )
  })
  await t.context.s3.send(putObjectCmd)

  const spaceMetricsTable = createSpaceMetricsTable(REGION, tableName, {
    endpoint: t.context.dbEndpoint
  })
  const carStoreBucket = createCarStore(REGION, bucketName, t.context.s3Opts)

  const invocations = [{
    carCid: car.cid.toString(),
    value: {
      att: [
        StoreCapabilities.add.create({
          with: spaceDid,
          nb: {
            link: car.cid,
            size: car.size
          }
        })
      ],
      aud: uploadService.did(),
      iss: alice.did()
    },
    type: STREAM_TYPE.RECEIPT,
    out: {
      ok: true
    },
    ts: Date.now()
  }]

  // @ts-expect-error
  await updateAddSizeTotal(invocations, {
    spaceMetricsTable,
    carStoreBucket
  })

  const item = await getItemFromTable(t.context.dynamoClient, tableName, {
    space: spaceDid,
    name: SPACE_METRICS_NAMES.STORE_ADD_SIZE_TOTAL
  })
  t.truthy(item)
  t.is(item?.value, car.size)
  t.is(item?.space, spaceDid)
})

test('handles batch of single invocation with multiple store/add attributes', async t => {
  const { tableName, bucketName } = await prepareResources(t.context.dynamoClient, t.context.s3)
  const uploadService = await Signer.generate()
  const alice = await Signer.generate()
  const { spaceDid } = await createSpace(alice)

  const cars = await Promise.all(
    Array.from({ length: 10 }).map(() => randomCAR(128))
  )
  // Put CARs to bucket
  await Promise.all(cars.map(async car => {
    const putObjectCmd = new PutObjectCommand({
      Key: `${car.cid.toString()}/${car.cid.toString()}.car`,
      Bucket: bucketName,
      Body: Buffer.from(
        await car.arrayBuffer()
      )
    })
    return t.context.s3.send(putObjectCmd)
  }))

  const spaceMetricsTable = createSpaceMetricsTable(REGION, tableName, {
    endpoint: t.context.dbEndpoint
  })
  const carStoreBucket = createCarStore(REGION, bucketName, t.context.s3Opts)

  const invocations = [{
    carCid: cars[0].cid.toString(),
    value: {
      att: cars.map((car) => StoreCapabilities.add.create({
        with: spaceDid,
        nb: {
          link: car.cid,
          size: car.size
        }
      })),
      aud: uploadService.did(),
      iss: alice.did()
    },
    type: STREAM_TYPE.RECEIPT,
    out: {
      ok: true
    },
    ts: Date.now()
  }]

  // @ts-expect-error
  await updateAddSizeTotal(invocations, {
    spaceMetricsTable,
    carStoreBucket
  })

  const item = await getItemFromTable(t.context.dynamoClient, tableName, {
    space: spaceDid,
    name: SPACE_METRICS_NAMES.STORE_ADD_SIZE_TOTAL
  })
  t.truthy(item)
  t.is(item?.value, cars.reduce((acc, c) => acc + c.size, 0))
  t.is(item?.space, spaceDid)
})

test('handles batch of multiple invocations with store/add in same space', async t => {
  const { tableName, bucketName } = await prepareResources(t.context.dynamoClient, t.context.s3)
  const uploadService = await Signer.generate()
  const alice = await Signer.generate()
  const { spaceDid } = await createSpace(alice)

  const cars = await Promise.all(
    Array.from({ length: 10 }).map(() => randomCAR(128))
  )
  // Put CARs to bucket
  await Promise.all(cars.map(async car => {
    const putObjectCmd = new PutObjectCommand({
      Key: `${car.cid.toString()}/${car.cid.toString()}.car`,
      Bucket: bucketName,
      Body: Buffer.from(
        await car.arrayBuffer()
      )
    })
    return t.context.s3.send(putObjectCmd)
  }))

  const spaceMetricsTable = createSpaceMetricsTable(REGION, tableName, {
    endpoint: t.context.dbEndpoint
  })
  const carStoreBucket = createCarStore(REGION, bucketName, t.context.s3Opts)

  const invocations = cars.map((car) => ({
    carCid: car.cid.toString(),
    value: {
      att: [
        StoreCapabilities.add.create({
          with: spaceDid,
          nb: {
            link: car.cid,
            size: car.size
          }
        })
      ],
      aud: uploadService.did(),
      iss: alice.did()
    },
    type: STREAM_TYPE.RECEIPT,
    out: {
      ok: true
    },
    ts: Date.now()
  }))

  // @ts-expect-error
  await updateAddSizeTotal(invocations, {
    spaceMetricsTable,
    carStoreBucket
  })

  const item = await getItemFromTable(t.context.dynamoClient, tableName, {
    space: spaceDid,
    name: SPACE_METRICS_NAMES.STORE_ADD_SIZE_TOTAL
  })
  t.truthy(item)
  t.is(item?.value, cars.reduce((acc, c) => acc + c.size, 0))
  t.is(item?.space, spaceDid)
})

test('handles batch of multiple invocations with store/add in multiple spaces', async t => {
  const { tableName, bucketName } = await prepareResources(t.context.dynamoClient, t.context.s3)
  const uploadService = await Signer.generate()
  const alice = await Signer.generate()
  const spaces = await Promise.all(
    Array.from({ length: 10 }).map(() => createSpace(alice))
  )

  const car = await randomCAR(128)
  // Put CAR to bucket
  const putObjectCmd = new PutObjectCommand({
    Key: `${car.cid.toString()}/${car.cid.toString()}.car`,
    Bucket: bucketName,
    Body: Buffer.from(
      await car.arrayBuffer()
    )
  })
  await t.context.s3.send(putObjectCmd)

  const spaceMetricsTable = createSpaceMetricsTable(REGION, tableName, {
    endpoint: t.context.dbEndpoint
  })
  const carStoreBucket = createCarStore(REGION, bucketName, t.context.s3Opts)

  const invocations = spaces.map(({ spaceDid }) => ({
    carCid: car.cid.toString(),
    value: {
      att: [
        StoreCapabilities.add.create({
          with: spaceDid,
          nb: {
            link: car.cid,
            size: car.size
          }
        })
      ],
      aud: uploadService.did(),
      iss: alice.did()
    },
    type: STREAM_TYPE.RECEIPT,
    out: {
      ok: true
    },
    ts: Date.now()
  }))

  // @ts-expect-error
  await updateAddSizeTotal(invocations, {
    spaceMetricsTable,
    carStoreBucket
  })

  const items = await Promise.all(
    spaces.map(({ spaceDid }) => getItemFromTable(t.context.dynamoClient, tableName, {
      space: spaceDid,
      name: SPACE_METRICS_NAMES.STORE_ADD_SIZE_TOTAL
    }))
  )
  t.truthy(items)
  t.is(items.length, spaces.length)

  for (const item of items) {
    t.is(item?.value, car.size)
  }
})


test('errors handling batch of multiple invocations with more transactions than allowed', async t => {
  const { tableName, bucketName } = await prepareResources(t.context.dynamoClient, t.context.s3)
  const uploadService = await Signer.generate()
  const alice = await Signer.generate()
  const spaces = await Promise.all(
    Array.from({ length: 105 }).map(() => createSpace(alice))
  )

  const car = await randomCAR(128)
  // Put CAR to bucket
  const putObjectCmd = new PutObjectCommand({
    Key: `${car.cid.toString()}/${car.cid.toString()}.car`,
    Bucket: bucketName,
    Body: Buffer.from(
      await car.arrayBuffer()
    )
  })
  await t.context.s3.send(putObjectCmd)

  const spaceMetricsTable = createSpaceMetricsTable(REGION, tableName, {
    endpoint: t.context.dbEndpoint
  })
  const carStoreBucket = createCarStore(REGION, bucketName, t.context.s3Opts)

  const invocations = spaces.map(({ spaceDid }) => ({
    carCid: car.cid.toString(),
    value: {
      att: [
        StoreCapabilities.add.create({
          with: spaceDid,
          nb: {
            link: car.cid,
            size: car.size
          }
        })
      ],
      aud: uploadService.did(),
      iss: alice.did()
    },
    type: STREAM_TYPE.RECEIPT,
    out: {
      ok: true
    },
    ts: Date.now()
  }))

  // @ts-expect-error
  await t.throwsAsync(() => updateAddSizeTotal(invocations, {
    spaceMetricsTable,
    carStoreBucket
  }))
})

/**
 * @param {import('@aws-sdk/client-dynamodb').DynamoDBClient} dynamoClient
 * @param {import('@aws-sdk/client-s3').S3Client} s3Client
 */
async function prepareResources (dynamoClient, s3Client) {
  const [ tableName, bucketName ] = await Promise.all([
    createDynamoTable(dynamoClient, spaceMetricsTableProps),
    createBucket(s3Client)
  ])

  return {
    tableName,
    bucketName
  }
}
