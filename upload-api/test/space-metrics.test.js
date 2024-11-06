import { testMetrics as test } from './helpers/context.js'

import { QueryCommand } from '@aws-sdk/client-dynamodb'
import { unmarshall } from '@aws-sdk/util-dynamodb'
import * as BlobCapabilities from '@storacha/capabilities/space/blob'
import * as UploadCapabilities from '@storacha/capabilities/upload'
import * as Signer from '@ucanto/principal/ed25519'
import { spaceMetricsTableProps, allocationTableProps } from '../tables/index.js'
import { SPACE_METRICS_NAMES } from '../constants.js'

import {
  createDynamodDb,
  createTable,
  createS3,
  createBucket
} from './helpers/resources.js'
import { createSpace } from './helpers/ucan.js'
import { randomCAR, randomBlob } from './helpers/random.js'

import * as Stream from '../stores/agent/stream.js'
import { useCarStore } from '../buckets/car-store.js'
import { useMetricsTable } from '../stores/space-metrics.js'
import { useAllocationsStorage } from '../stores/blob-registry.js'
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
  const allocationsTableName = await createTable(dynamo, allocationTableProps)
  const allocationsStorage = useAllocationsStorage(dynamo, allocationsTableName)
  const carStoreBucketName = await createBucket(s3)
  const carStore = useCarStore(s3, carStoreBucketName)

  Object.assign(t.context, {
    spaceMetricsStore,
    spaceMetricsTableName,
    carStore,
    carStoreBucketName,
    allocationsStorage,
    allocationsTableName
  })
})

test('handles a batch of single invocation with blob/add', async t => {
  const { spaceMetricsStore, carStore, allocationsStorage } = t.context
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
    type: Stream.defaults.receipt.type,
    out: {
      ok: true
    },
    ts: Date.now()
  }]

  // simulate invocation serialization & deserialization as done by agent store:
  // ../stores/agent/stream.js
  const serdeInvocations = JSON.parse(JSON.stringify(invocations))
  await updateSpaceMetrics(serdeInvocations, {
    metricsStore: spaceMetricsStore,
    carStore,
    allocationsStorage
  })
  
  const spaceMetrics = await getMetricsFromSpace(t.context.dynamo, t.context.spaceMetricsTableName, spaceDid)
  t.truthy(spaceMetrics)
  t.deepEqual(spaceMetrics[SPACE_METRICS_NAMES.BLOB_ADD_TOTAL], 1)
  t.deepEqual(spaceMetrics[SPACE_METRICS_NAMES.BLOB_ADD_SIZE_TOTAL], blob.size)
})

test('handles batch of single invocations with multiple blob/add attributes', async t => {
  const { spaceMetricsStore, carStore, allocationsStorage } = t.context
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
    type: Stream.defaults.receipt.type,
    out: {
      ok: true
    },
    ts: Date.now()
  }]

  // simulate invocation serialization & deserialization as done by agent store:
  // ../stores/agent/stream.js
  const serdeInvocations = JSON.parse(JSON.stringify(invocations))
  await updateSpaceMetrics(serdeInvocations, {
    metricsStore: spaceMetricsStore,
    carStore,
    allocationsStorage
  })
  
  const spaceMetrics = await getMetricsFromSpace(t.context.dynamo, t.context.spaceMetricsTableName, spaceDid)
  t.truthy(spaceMetrics)
  t.deepEqual(spaceMetrics[SPACE_METRICS_NAMES.BLOB_ADD_TOTAL], blobs.length)
  t.deepEqual(spaceMetrics[SPACE_METRICS_NAMES.BLOB_ADD_SIZE_TOTAL], blobs.reduce((acc, c) => {
    return acc + c.size
  }, 0))
})

test('handles a batch of single invocation with blob/add without receipt', async t => {
  const { spaceMetricsStore, carStore, allocationsStorage } = t.context
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
    type: Stream.defaults.workflow.type,
    out: {
      ok: true
    },
    ts: Date.now()
  }]

  // simulate invocation serialization & deserialization as done by agent store:
  // ../stores/agent/stream.js
  const serdeInvocations = JSON.parse(JSON.stringify(invocations))
  await updateSpaceMetrics(serdeInvocations, {
    metricsStore: spaceMetricsStore,
    carStore,
    allocationsStorage
  })
  
  const spaceMetrics = await getMetricsFromSpace(t.context.dynamo, t.context.spaceMetricsTableName, spaceDid)
  t.truthy(spaceMetrics)

  t.falsy(spaceMetrics[SPACE_METRICS_NAMES.BLOB_ADD_TOTAL])
  t.falsy(spaceMetrics[SPACE_METRICS_NAMES.BLOB_ADD_SIZE_TOTAL])
})

test('handles a batch of invocations with upload-api tracking capabilities', async t => {
  const { spaceMetricsStore, carStore, allocationsStorage } = t.context
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
      type: Stream.defaults.receipt.type,
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
      type: Stream.defaults.receipt.type,
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
      type: Stream.defaults.receipt.type,
      out: {
        ok: true
      },
      ts: Date.now() + 2
    },
    // blob/remove
    ...blobs.map((blob, i) => ({
      carCid: car.cid.toString(),
      value: {
        att: [BlobCapabilities.remove.create({
          with: spaceDid,
          nb: {
            digest: blob.digest,
          }
        })],
        aud: uploadService.did(),
        iss: alice.did()
      },
      type: Stream.defaults.receipt.type,
      out: {
        ok: {
          size: blob.size
        }
      },
      ts: Date.now() + 3 + i
    })),
  ]

  // simulate invocation serialization & deserialization as done by agent store:
  // ../stores/agent/stream.js
  const serdeInvocations = JSON.parse(JSON.stringify(invocations))
  await updateSpaceMetrics(serdeInvocations, {
    metricsStore: spaceMetricsStore,
    carStore,
    allocationsStorage
  })
  
  const spaceMetrics = await getMetricsFromSpace(t.context.dynamo, t.context.spaceMetricsTableName, spaceDid)
  t.truthy(spaceMetrics)

  // `blob/add`
  t.deepEqual(spaceMetrics[SPACE_METRICS_NAMES.BLOB_ADD_TOTAL], blobs.length)
  t.deepEqual(spaceMetrics[SPACE_METRICS_NAMES.BLOB_ADD_SIZE_TOTAL], blobs.reduce((acc, c) => {
    return acc + c.size
  }, 0))
  // `upload/add`
  t.deepEqual(spaceMetrics[SPACE_METRICS_NAMES.UPLOAD_ADD_TOTAL], 1)
  // `upload/remove`
  t.deepEqual(spaceMetrics[SPACE_METRICS_NAMES.UPLOAD_REMOVE_TOTAL], 1)
  // `blob/remove`
  t.deepEqual(spaceMetrics[SPACE_METRICS_NAMES.BLOB_REMOVE_TOTAL], blobs.length)
  t.deepEqual(spaceMetrics[SPACE_METRICS_NAMES.BLOB_REMOVE_SIZE_TOTAL], blobs.reduce((acc, c) => {
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
