import { testMetrics as test } from './helpers/context.js'

import { QueryCommand } from '@aws-sdk/client-dynamodb'
import { unmarshall } from '@aws-sdk/util-dynamodb'
import { PutObjectCommand } from '@aws-sdk/client-s3'
import * as StoreCapabilities from '@web3-storage/capabilities/store'
import * as UploadCapabilities from '@web3-storage/capabilities/upload'
import * as Signer from '@ucanto/principal/ed25519'
import { spaceMetricsTableProps } from '../tables/index.js'
import { SPACE_METRICS_NAMES } from '../constants.js'

import {
  createDynamodDb,
  createTable,
  createS3,
  createBucket
} from './helpers/resources.js'
import { createSpace } from './helpers/ucan.js'
import { randomCAR } from './helpers/random.js'

import { STREAM_TYPE } from '../ucan-invocation.js'
import { useCarStore } from '../buckets/car-store.js'
import { useMetricsTable } from '../stores/space-metrics.js'
import { updateSpaceMetrics } from '../metrics.js'

test.before(async t => {
  const dynamo = await createDynamodDb()
  const { client: s3 } = await createS3()

  Object.assign(t.context, {
    dynamo,
    s3
  })
})

test.beforeEach(async t => {
  const { dynamo, s3 } = t.context
  const spaceMetricsTableName = await createTable(dynamo, spaceMetricsTableProps)
  const spaceMetricsStore = useMetricsTable(dynamo, spaceMetricsTableName)
  const carStoreBucketName = await createBucket(s3)
  const carStore = useCarStore(s3, carStoreBucketName)

  Object.assign(t.context, {
    spaceMetricsStore,
    spaceMetricsTableName,
    carStore,
    carStoreBucketName
  })
})

test('handles a batch of single invocation with store/add', async t => {
  const { spaceMetricsStore, carStore } = t.context
  const uploadService = await Signer.generate()
  const alice = await Signer.generate()
  const { spaceDid } = await createSpace(alice)
  const car = await randomCAR(128)

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
  await updateSpaceMetrics(invocations, {
    metricsStore: spaceMetricsStore,
    carStore
  })
  
  const spaceMetrics = await getMetricsFromSpace(t.context.dynamo, t.context.spaceMetricsTableName, spaceDid)
  t.truthy(spaceMetrics)
  t.deepEqual(spaceMetrics[SPACE_METRICS_NAMES.STORE_ADD_TOTAL], 1)
  t.deepEqual(spaceMetrics[SPACE_METRICS_NAMES.STORE_ADD_SIZE_TOTAL], car.size)
})

test('handles batch of single invocations with multiple store/add attributes', async t => {
  const { spaceMetricsStore, carStore } = t.context
  const uploadService = await Signer.generate()
  const alice = await Signer.generate()
  const { spaceDid } = await createSpace(alice)
  const cars = await Promise.all(
    Array.from({ length: 10 }).map(() => randomCAR(128))
  )

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
  await updateSpaceMetrics(invocations, {
    metricsStore: spaceMetricsStore,
    carStore
  })
  
  const spaceMetrics = await getMetricsFromSpace(t.context.dynamo, t.context.spaceMetricsTableName, spaceDid)
  t.truthy(spaceMetrics)
  t.deepEqual(spaceMetrics[SPACE_METRICS_NAMES.STORE_ADD_TOTAL], cars.length)
  t.deepEqual(spaceMetrics[SPACE_METRICS_NAMES.STORE_ADD_SIZE_TOTAL], cars.reduce((acc, c) => {
    return acc + c.size
  }, 0))
})

test('handles a batch of single invocation with store/add without receipt', async t => {
  const { spaceMetricsStore, carStore } = t.context
  const uploadService = await Signer.generate()
  const alice = await Signer.generate()
  const { spaceDid } = await createSpace(alice)
  const car = await randomCAR(128)

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
    type: STREAM_TYPE.WORKFLOW,
    out: {
      ok: true
    },
    ts: Date.now()
  }]

  // @ts-expect-error
  await updateSpaceMetrics(invocations, {
    metricsStore: spaceMetricsStore,
    carStore
  })
  
  const spaceMetrics = await getMetricsFromSpace(t.context.dynamo, t.context.spaceMetricsTableName, spaceDid)
  t.truthy(spaceMetrics)

  t.falsy(spaceMetrics[SPACE_METRICS_NAMES.STORE_ADD_TOTAL])
  t.falsy(spaceMetrics[SPACE_METRICS_NAMES.STORE_ADD_SIZE_TOTAL])
})

test('handles a batch of invocations with upload-api tracking capabilities', async t => {
  const { spaceMetricsStore, carStore, carStoreBucketName } = t.context
  const uploadService = await Signer.generate()
  const alice = await Signer.generate()
  const { spaceDid } = await createSpace(alice)
  const cars = await Promise.all(
    Array.from({ length: 3 }).map(() => randomCAR(128))
  )
  // Put CARs to bucket
  await Promise.all(cars.map(async car => {
    const putObjectCmd = new PutObjectCommand({
      Key: `${car.cid.toString()}/${car.cid.toString()}.car`,
      Bucket: carStoreBucketName,
      Body: Buffer.from(
        await car.arrayBuffer()
      )
    })
    return t.context.s3.send(putObjectCmd)
  }))

  const invocations = [
    // store/add
    {
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
    },
    // upload/add
    {
      carCid: cars[0].cid.toString(),
      value: {
          att: [
            UploadCapabilities.add.create({
              with: spaceDid,
              nb: {
                root: cars[0].cid,
                shards: cars.map(car => car.cid)
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
      ts: Date.now() + 1
    },
    // upload/remove
    {
      carCid: cars[0].cid.toString(),
      value: {
          att: [
            UploadCapabilities.remove.create({
              with: spaceDid,
              nb: {
                root: cars[0].cid,
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
      ts: Date.now() + 2
    },
    // store/remove
    {
      carCid: cars[0].cid.toString(),
      value: {
        att: cars.map((car) => StoreCapabilities.remove.create({
          with: spaceDid,
          nb: {
            link: car.cid,
          }
        })),
        aud: uploadService.did(),
        iss: alice.did()
      },
      type: STREAM_TYPE.RECEIPT,
      out: {
        ok: true
      },
      ts: Date.now() + 3
    },
  ]

  // @ts-expect-error
  await updateSpaceMetrics(invocations, {
    metricsStore: spaceMetricsStore,
    carStore
  })
  
  const spaceMetrics = await getMetricsFromSpace(t.context.dynamo, t.context.spaceMetricsTableName, spaceDid)
  t.truthy(spaceMetrics)

  // `store/add`
  t.deepEqual(spaceMetrics[SPACE_METRICS_NAMES.STORE_ADD_TOTAL], cars.length)
  t.deepEqual(spaceMetrics[SPACE_METRICS_NAMES.STORE_ADD_SIZE_TOTAL], cars.reduce((acc, c) => {
    return acc + c.size
  }, 0))
  // `upload/add`
  t.deepEqual(spaceMetrics[SPACE_METRICS_NAMES.UPLOAD_ADD_TOTAL], 1)
  // `upload/remove`
  t.deepEqual(spaceMetrics[SPACE_METRICS_NAMES.UPLOAD_REMOVE_TOTAL], 1)
  // `store/remove`
  t.deepEqual(spaceMetrics[SPACE_METRICS_NAMES.STORE_REMOVE_TOTAL], cars.length)
  t.deepEqual(spaceMetrics[SPACE_METRICS_NAMES.STORE_REMOVE_SIZE_TOTAL], cars.reduce((acc, c) => {
    return acc + c.size
  }, 0))
})

/**
 * @param {import('@aws-sdk/client-dynamodb').DynamoDBClient} dynamo
 * @param {string} tableName
 * @param {string} space
 */
export async function getMetricsFromSpace(dynamo, tableName, space) {
  const params = {
    TableName: tableName,
    KeyConditions: {
      space: {
        ComparisonOperator: 'EQ',
        AttributeValueList: [{ S: space }],
      },
    },
  }
  // @ts-expect-error
  const response = await dynamo.send(new QueryCommand(params))
  return response.Items?.map(i => unmarshall(i)).reduce((obj, item) => Object.assign(obj, { [item.name]: item.value }), {}) || {}
}
