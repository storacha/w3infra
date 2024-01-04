import { testMetrics as test } from './helpers/context.js'

import { PutObjectCommand } from '@aws-sdk/client-s3'
import * as StoreCapabilities from '@web3-storage/capabilities/store'
import * as UploadCapabilities from '@web3-storage/capabilities/upload'
import * as Signer from '@ucanto/principal/ed25519'
import { adminMetricsTableProps } from '../tables/index.js'
import { METRICS_NAMES } from '../constants.js'

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
import { useMetricsTable } from '../stores/metrics.js'
import { updateAdminMetrics } from '../metrics.js'
import { useMetricsTable as useMetricsGetTable } from '../tables/metrics.js'
import { getMetrics } from '../functions/metrics.js'

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
  const adminMetricsTableName = await createTable(dynamo, adminMetricsTableProps)
  const adminMetricsStore = useMetricsTable(dynamo, adminMetricsTableName)
  const carStoreBucketName = await createBucket(s3)
  const carStore = useCarStore(s3, carStoreBucketName)
  Object.assign(t.context, {
    adminMetricsStore,
    adminMetricsTableName,
    carStore,
    carStoreBucketName
  })
})

test('handles a batch of single invocation with store/add', async t => {
  const { adminMetricsStore, carStore } = t.context
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
  await updateAdminMetrics(invocations, {
    metricsStore: adminMetricsStore,
    carStore
  })
  const metricsTable = useMetricsGetTable(t.context.dynamo, t.context.adminMetricsTableName)
  const metrics = await getMetrics(metricsTable)

  t.deepEqual(metrics[METRICS_NAMES.STORE_ADD_TOTAL], 1)
  t.deepEqual(metrics[METRICS_NAMES.STORE_ADD_SIZE_TOTAL], car.size)
})

test('handles batch of single invocations with multiple store/add attributes', async t => {
  const { adminMetricsStore, carStore } = t.context
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
  await updateAdminMetrics(invocations, {
    metricsStore: adminMetricsStore,
    carStore
  })
  const metricsTable = useMetricsGetTable(t.context.dynamo, t.context.adminMetricsTableName)
  const metrics = await getMetrics(metricsTable)

  t.deepEqual(metrics[METRICS_NAMES.STORE_ADD_TOTAL], cars.length)
  t.deepEqual(metrics[METRICS_NAMES.STORE_ADD_SIZE_TOTAL], cars.reduce((acc, c) => {
    return acc + c.size
  }, 0))
})

test('handles a batch of single invocation with store/add without receipt', async t => {
  const { adminMetricsStore, carStore } = t.context
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
  await updateAdminMetrics(invocations, {
    metricsStore: adminMetricsStore,
    carStore
  })
  const metricsTable = useMetricsGetTable(t.context.dynamo, t.context.adminMetricsTableName)
  const metrics = await getMetrics(metricsTable)

  t.falsy(metrics[METRICS_NAMES.STORE_ADD_TOTAL])
  t.falsy(metrics[METRICS_NAMES.STORE_ADD_SIZE_TOTAL])
})

test('handles a batch of invocations with upload-api tracking capabilities', async t => {
  const { adminMetricsStore, carStore, carStoreBucketName } = t.context
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
  await updateAdminMetrics(invocations, {
    metricsStore: adminMetricsStore,
    carStore
  })
  const metricsTable = useMetricsGetTable(t.context.dynamo, t.context.adminMetricsTableName)
  const metrics = await getMetrics(metricsTable)

  // `store/add`
  t.deepEqual(metrics[METRICS_NAMES.STORE_ADD_TOTAL], cars.length)
  t.deepEqual(metrics[METRICS_NAMES.STORE_ADD_SIZE_TOTAL], cars.reduce((acc, c) => {
    return acc + c.size
  }, 0))
  // `upload/add`
  t.deepEqual(metrics[METRICS_NAMES.UPLOAD_ADD_TOTAL], 1)
  // `upload/remove`
  t.deepEqual(metrics[METRICS_NAMES.UPLOAD_REMOVE_TOTAL], 1)
  // `store/remove`
  t.deepEqual(metrics[METRICS_NAMES.STORE_REMOVE_TOTAL], cars.length)
  t.deepEqual(metrics[METRICS_NAMES.STORE_REMOVE_SIZE_TOTAL], cars.reduce((acc, c) => {
    return acc + c.size
  }, 0))
})
