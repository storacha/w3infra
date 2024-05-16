import { testMetrics as test } from './helpers/context.js'

import * as BlobCapabilities from '@web3-storage/capabilities/blob'
import * as UploadCapabilities from '@web3-storage/capabilities/upload'
import * as Signer from '@ucanto/principal/ed25519'
import { adminMetricsTableProps, allocationTableProps } from '../tables/index.js'
import { METRICS_NAMES } from '../constants.js'

import {
  createDynamodDb,
  createTable,
  createS3,
  createBucket
} from './helpers/resources.js'
import { createSpace } from './helpers/ucan.js'
import { randomBlob, randomCAR } from './helpers/random.js'

import { STREAM_TYPE } from '../ucan-invocation.js'
import { useCarStore } from '../buckets/car-store.js'
import { useMetricsTable } from '../stores/metrics.js'
import { useAllocationsStorage } from '../stores/allocations.js'
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
  const allocationsTableName = await createTable(dynamo, allocationTableProps)
  const allocationsStorage = useAllocationsStorage(dynamo, allocationsTableName)
  const carStoreBucketName = await createBucket(s3)
  const carStore = useCarStore(s3, carStoreBucketName)
  Object.assign(t.context, {
    adminMetricsStore,
    adminMetricsTableName,
    carStore,
    carStoreBucketName,
    allocationsStorage,
    allocationsTableName
  })
})

test('handles a batch of single invocation with blob/add', async t => {
  const { adminMetricsStore, carStore, allocationsStorage } = t.context
  const uploadService = await Signer.generate()
  const alice = await Signer.generate()
  const { spaceDid } = await createSpace(alice)
  const blob = await randomBlob(128)
  const car = await randomCAR(128)

  const invocations = [{
    carCid: car.cid.toString(),
    value: {
        att: [
          BlobCapabilities.add.create({
            with: spaceDid,
            nb: {
              blob
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
    carStore,
    allocationsStorage
  })
  const metricsTable = useMetricsGetTable(t.context.dynamo, t.context.adminMetricsTableName)
  const metrics = await getMetrics(metricsTable)

  t.deepEqual(metrics[METRICS_NAMES.BLOB_ADD_TOTAL], 1)
  t.deepEqual(metrics[METRICS_NAMES.BLOB_ADD_SIZE_TOTAL], blob.size)
})

test('handles batch of single invocations with multiple blob/add attributes', async t => {
  const { adminMetricsStore, carStore, allocationsStorage } = t.context
  const uploadService = await Signer.generate()
  const alice = await Signer.generate()
  const { spaceDid } = await createSpace(alice)
  const car = await randomCAR(128)
  const blobs = await Promise.all(
    Array.from({ length: 10 }).map(() => randomBlob(128))
  )

  const invocations = [{
    carCid: car.cid.toString(),
    value: {
      att: blobs.map((blob) => BlobCapabilities.add.create({
        with: spaceDid,
        nb: {
          blob
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
    carStore,
    allocationsStorage
  })
  const metricsTable = useMetricsGetTable(t.context.dynamo, t.context.adminMetricsTableName)
  const metrics = await getMetrics(metricsTable)

  t.deepEqual(metrics[METRICS_NAMES.BLOB_ADD_TOTAL], blobs.length)
  t.deepEqual(metrics[METRICS_NAMES.BLOB_ADD_SIZE_TOTAL], blobs.reduce((acc, c) => {
    return acc + c.size
  }, 0))
})

test('handles a batch of single invocation with blob/add without receipt', async t => {
  const { adminMetricsStore, carStore, allocationsStorage } = t.context
  const uploadService = await Signer.generate()
  const alice = await Signer.generate()
  const { spaceDid } = await createSpace(alice)
  const blob = await randomBlob(128)
  const car = await randomCAR(128)

  const invocations = [{
    carCid: car.cid.toString(),
    value: {
        att: [
          BlobCapabilities.add.create({
            with: spaceDid,
            nb: {
              blob
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
    carStore,
    allocationsStorage
  })
  const metricsTable = useMetricsGetTable(t.context.dynamo, t.context.adminMetricsTableName)
  const metrics = await getMetrics(metricsTable)

  t.falsy(metrics[METRICS_NAMES.BLOB_ADD_TOTAL])
  t.falsy(metrics[METRICS_NAMES.BLOB_ADD_SIZE_TOTAL])
})

test('handles a batch of invocations with upload-api tracking capabilities', async t => {
  const { adminMetricsStore, carStore, allocationsStorage } = t.context
  const uploadService = await Signer.generate()
  const alice = await Signer.generate()
  const { spaceDid } = await createSpace(alice)
  const car = await randomCAR(128)
  const blobs = await Promise.all(
    Array.from({ length: 3 }).map(() => randomBlob(128))
  )

  // Allocate Blobs
  await Promise.all(blobs.map(async blob => {
    const allocateRes = await allocationsStorage.insert({
      space: spaceDid,
      cause: car.cid,
      blob
    })

    t.truthy(allocateRes.ok)
  }))

  const invocations = [
    // blob/add
    {
      carCid: car.cid.toString(),
      value: {
        att: blobs.map((blob) => BlobCapabilities.add.create({
          with: spaceDid,
          nb: {
            blob
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
      carCid: car.cid.toString(),
      value: {
          att: [
            UploadCapabilities.add.create({
              with: spaceDid,
              nb: {
                root: blobs[0].cid,
                shards: blobs.map(blob => car.cid)
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
      carCid: car.cid.toString(),
      value: {
          att: [
            UploadCapabilities.remove.create({
              with: spaceDid,
              nb: {
                root: blobs[0].cid,
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
    // blob/remove
    {
      carCid: car.cid.toString(),
      value: {
        att: blobs.map((blob) => BlobCapabilities.remove.create({
          with: spaceDid,
          nb: {
            digest: blob.digest,
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
    carStore,
    allocationsStorage
  })
  const metricsTable = useMetricsGetTable(t.context.dynamo, t.context.adminMetricsTableName)
  const metrics = await getMetrics(metricsTable)

  // `blob/add`
  t.deepEqual(metrics[METRICS_NAMES.BLOB_ADD_TOTAL], blobs.length)
  t.deepEqual(metrics[METRICS_NAMES.BLOB_ADD_SIZE_TOTAL], blobs.reduce((acc, c) => {
    return acc + c.size
  }, 0))
  // `upload/add`
  t.deepEqual(metrics[METRICS_NAMES.UPLOAD_ADD_TOTAL], 1)
  // `upload/remove`
  t.deepEqual(metrics[METRICS_NAMES.UPLOAD_REMOVE_TOTAL], 1)
  // `blob/remove`
  t.deepEqual(metrics[METRICS_NAMES.BLOB_REMOVE_TOTAL], blobs.length)
  t.deepEqual(metrics[METRICS_NAMES.BLOB_REMOVE_SIZE_TOTAL], blobs.reduce((acc, c) => {
    return acc + c.size
  }, 0))
})
