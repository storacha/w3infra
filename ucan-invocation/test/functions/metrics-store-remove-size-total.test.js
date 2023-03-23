import { testConsumerWithBucket as test } from '../helpers/context.js'

import * as Signer from '@ucanto/principal/ed25519'
import * as StoreCapabilities from '@web3-storage/capabilities/store'
import { PutObjectCommand } from '@aws-sdk/client-s3'

import { createSpace } from '../helpers/ucanto.js'
import { randomCAR } from '../helpers/random.js'
import { createDynamoTable, getItemFromTable} from '../helpers/tables.js'
import { adminMetricsTableProps } from '../../tables/index.js'
import {
  createDynamodDb,
  createS3,
  createBucket,
} from '../helpers/resources.js'

import { updateRemoveSizeTotal } from '../../functions/metrics-store-remove-size-total.js'
import { createMetricsTable } from '../../tables/metrics.js'
import { createCarStore } from '../../buckets/car-store.js'
import { METRICS_NAMES, CONTENT_TYPE } from '../../constants.js'

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

test('handles a batch of single invocation with store/remove', async t => {
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

  const metricsTable = createMetricsTable(REGION, tableName, {
    endpoint: t.context.dbEndpoint
  })
  const carStoreBucket = createCarStore(REGION, bucketName, t.context.s3Opts)
  const invocations = [{
    carCid: car.cid.toString(),
    value: {
        att: [
          StoreCapabilities.remove.create({
            with: spaceDid,
            nb: {
              link: car.cid
            }
          })
        ],
        aud: uploadService.did(),
        iss: alice.did()
    },
    type: CONTENT_TYPE.RECEIPT,
    ts: Date.now()
  }]

  // @ts-expect-error
  await updateRemoveSizeTotal(invocations, {
    metricsTable,
    carStoreBucket
  })

  const item = await getItemFromTable(t.context.dynamoClient, tableName, {
    name: METRICS_NAMES.STORE_REMOVE_SIZE_TOTAL
  })
  t.truthy(item)
  t.is(item?.name, METRICS_NAMES.STORE_REMOVE_SIZE_TOTAL)
  t.is(item?.value, car.size)
})

test('handles batch of single invocations with multiple store/remove attributes', async t => {
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

  const metricsTable = createMetricsTable(REGION, tableName, {
    endpoint: t.context.dbEndpoint
  })
  const carStoreBucket = createCarStore(REGION, bucketName, t.context.s3Opts)

  const invocations = [{
    carCid: cars[0].cid.toString(),
    value: {
      att: cars.map((car) => StoreCapabilities.remove.create({
        with: spaceDid,
        nb: {
          link: car.cid
        }
      })),
      aud: uploadService.did(),
      iss: alice.did()
    },
    type: CONTENT_TYPE.RECEIPT,
    ts: Date.now()
  }]

  // @ts-expect-error
  await updateRemoveSizeTotal(invocations, {
    metricsTable,
    carStoreBucket
  })

  const item = await getItemFromTable(t.context.dynamoClient, tableName, {
    name: METRICS_NAMES.STORE_REMOVE_SIZE_TOTAL
  })

  t.truthy(item)
  t.is(item?.name, METRICS_NAMES.STORE_REMOVE_SIZE_TOTAL)
  t.is(item?.value, cars.reduce((acc, c) => acc + c.size, 0))
})

test('handles a batch of single invocation without store/remove', async t => {
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

  const metricsTable = createMetricsTable(REGION, tableName, {
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
    type: CONTENT_TYPE.RECEIPT,
    ts: Date.now()
  }]

  // @ts-expect-error
  await updateRemoveSizeTotal(invocations, {
    metricsTable,
    carStoreBucket
  })

  const item = await getItemFromTable(t.context.dynamoClient, tableName, {
    name: METRICS_NAMES.STORE_REMOVE_SIZE_TOTAL
  })

  t.truthy(item)
  t.is(item?.name, METRICS_NAMES.STORE_REMOVE_SIZE_TOTAL)
  t.is(item?.value, 0)
})

test('handles a batch of single invocation without receipts', async t => {
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

  const metricsTable = createMetricsTable(REGION, tableName, {
    endpoint: t.context.dbEndpoint
  })
  const carStoreBucket = createCarStore(REGION, bucketName, t.context.s3Opts)

  const invocations = [{
    carCid: car.cid.toString(),
    value: {
        att: [
          StoreCapabilities.remove.create({
            with: spaceDid,
            nb: {
              link: car.cid
            }
          })
        ],
        aud: uploadService.did(),
        iss: alice.did()
    },
    type: CONTENT_TYPE.WORKFLOW,
    ts: Date.now()
  }]

  // @ts-expect-error
  await updateRemoveSizeTotal(invocations, {
    metricsTable,
    carStoreBucket
  })

  const item = await getItemFromTable(t.context.dynamoClient, tableName, {
    name: METRICS_NAMES.STORE_REMOVE_SIZE_TOTAL
  })

  t.truthy(item)
  t.is(item?.name, METRICS_NAMES.STORE_REMOVE_SIZE_TOTAL)
  t.is(item?.value, 0)
})

/**
 * @param {import('@aws-sdk/client-dynamodb').DynamoDBClient} dynamoClient
 * @param {import('@aws-sdk/client-s3').S3Client} s3Client
 */
async function prepareResources (dynamoClient, s3Client) {
  const [ tableName, bucketName ] = await Promise.all([
    createDynamoTable(dynamoClient, adminMetricsTableProps),
    createBucket(s3Client)
  ])

  return {
    bucketName,
    tableName
  }
}
