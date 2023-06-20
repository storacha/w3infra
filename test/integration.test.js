import { fetch } from '@web-std/fetch'
import git from 'git-rev-sync'
import pWaitFor from 'p-wait-for'
import { HeadObjectCommand } from '@aws-sdk/client-s3'

import { METRICS_NAMES, SPACE_METRICS_NAMES } from '../ucan-invocation/constants.js'
import { test } from './helpers/context.js'
import {
  stage,
  getApiEndpoint,
  getAwsBucketClient,
  getCloudflareBucketClient,
  getSatnavBucketInfo,
  getCarparkBucketInfo,
  getDynamoDb
} from './helpers/deployment.js'
import { setupNewClient } from './helpers/up-client.js'
import { randomFile } from './helpers/random.js'
import { getTableItem, getAllTableRows } from './helpers/table.js'

test.before(t => {
  t.context = {
    apiEndpoint: getApiEndpoint(),
    metricsDynamo: getDynamoDb('admin-metrics'),
    spaceMetricsDynamo: getDynamoDb('space-metrics')
  }
})

test('GET /', async t => {
  const response = await fetch(t.context.apiEndpoint)
  t.is(response.status, 200)
})

test('GET /version', async t => {
  const response = await fetch(`${t.context.apiEndpoint}/version`)
  t.is(response.status, 200)

  const body = await response.json()
  t.is(body.env, stage)
  t.is(body.commit, git.long('.'))
})

test('upload-api /metrics', async t => {
  const apiEndpoint = getApiEndpoint()

  const response = await fetch(`${apiEndpoint}/metrics`)
  t.is(response.status, 200)

  const body = await response.text()
  /**
   * # HELP w3up_bytes Total bytes associated with each invocation.
   * # TYPE w3up_bytes counter
   * w3up_bytes{can="store/add"} 0
   * w3up_bytes{can="store/remove"} 0
   */
  t.is((body.match(/w3up_bytes/g) || []).length, 4)
  /**
   * # HELP w3up_invocations_total Total number of invocations.
   * # TYPE w3up_invocations_total counter
   * w3up_invocations_total{can="store/add"} 1
   * w3up_invocations_total{can="store/remove"} 0
   * w3up_invocations_total{can="upload/add"} 0
   * w3up_invocations_total{can="upload/remove"} 1
   */
  t.is((body.match(/w3up_invocations_total/g) || []).length, 6)
})

// Integration test for all flow from uploading a file to Kinesis events consumers and replicator
test('w3infra integration flow', async t => {
  const client = await setupNewClient(t.context.apiEndpoint)
  const spaceDid = client.currentSpace()?.did()
  if (!spaceDid) {
    throw new Error('Testing space DID must be set')
  }

  // Get space metrics before upload
  const spaceBeforeUploadAddMetrics = await getSpaceMetrics(t, spaceDid, SPACE_METRICS_NAMES.UPLOAD_ADD_TOTAL)
  const spaceBeforeStoreAddMetrics = await getSpaceMetrics(t, spaceDid, SPACE_METRICS_NAMES.STORE_ADD_TOTAL)
  const spaceBeforeStoreAddSizeMetrics = await getSpaceMetrics(t, spaceDid, SPACE_METRICS_NAMES.STORE_ADD_SIZE_TOTAL)

  // Get metrics before upload
  const beforeOperationMetrics = await getMetrics(t)
  const beforeStoreAddTotal = beforeOperationMetrics.find(row => row.name === METRICS_NAMES.STORE_ADD_TOTAL)
  const beforeUploadAddTotal = beforeOperationMetrics.find(row => row.name === METRICS_NAMES.UPLOAD_ADD_TOTAL)
  const beforeStoreAddSizeTotal = beforeOperationMetrics.find(row => row.name === METRICS_NAMES.STORE_ADD_SIZE_TOTAL)

  const s3Client = getAwsBucketClient()
  const r2Client = getCloudflareBucketClient()

  const file = await randomFile(100)
  const shards = []

  // Upload new file
  const fileLink = await client.uploadFile(file, {
    onShardStored: (meta) => {
      shards.push(meta.cid)
    }
  })
  t.truthy(fileLink)
  t.is(shards.length, 1)

  // Check carpark
  const carparkRequest = await s3Client.send(
    new HeadObjectCommand({
      Bucket: (getCarparkBucketInfo()).Bucket,
      Key: `${shards[0].toString()}/${shards[0].toString()}.car`
    })
  )
  t.is(carparkRequest.$metadata.httpStatusCode, 200)

  const carSize = carparkRequest.ContentLength

  // Check dudewhere
  const dudewhereRequest = await r2Client.send(
    new HeadObjectCommand({
      Bucket: process.env.R2_DUDEWHERE_BUCKET_NAME || '',
      Key: `${fileLink.toString()}/${shards[0].toString()}`
    })
  )
  t.is(dudewhereRequest.$metadata.httpStatusCode, 200)

  // List space files
  let uploadFound, cursor
  do {
    const listResult = await client.capability.upload.list({
      size: 5,
      cursor
    })
    uploadFound = listResult.results.find(upload => upload.root.equals(fileLink))
    cursor = listResult.cursor
  } while (!uploadFound)

  t.is(uploadFound.shards?.length, 1)
  t.deepEqual(shards, uploadFound.shards)

  // Remove file from space
  const removeResult = await client.capability.upload.remove(fileLink)
  t.falsy(removeResult?.error)

  // Check Satnav side index asynchronously created
  await pWaitFor(async () => {
    let satnavRequest
    try {
      satnavRequest = await s3Client.send(
        new HeadObjectCommand({
          Bucket: (getSatnavBucketInfo()).Bucket,
          Key: `${shards[0].toString()}/${shards[0].toString()}.car.idx`
        })
      )
    } catch { }

    return satnavRequest?.$metadata.httpStatusCode === 200
  }, {
    interval: 100,
  })

  // Replicator
  // Check carpark
  await pWaitFor(async () => {
    let carpark
    try {
      carpark = await r2Client.send(
        new HeadObjectCommand({
          Bucket: process.env.R2_CARPARK_BUCKET_NAME || '',
          Key: `${shards[0].toString()}/${shards[0].toString()}.car`
        })
      )
    } catch { }

    return carpark?.$metadata.httpStatusCode === 200
  }, {
    interval: 100,
  })

  // Check satnav
  await pWaitFor(async () => {
    let satnav
    try {
      satnav = await r2Client.send(
        new HeadObjectCommand({
          Bucket: process.env.R2_SATNAV_BUCKET_NAME || '',
          Key: `${shards[0].toString()}/${shards[0].toString()}.car.idx`
        })
      )
    } catch { }

    return satnav?.$metadata.httpStatusCode === 200
  }, {
    interval: 100,
  })

  // Check metrics were updated
  if (beforeStoreAddSizeTotal && spaceBeforeUploadAddMetrics && spaceBeforeStoreAddSizeMetrics && beforeUploadAddTotal) {
    await pWaitFor(async () => {
      const afterOperationMetrics = await getMetrics(t)
      const afterStoreAddTotal = afterOperationMetrics.find(row => row.name === METRICS_NAMES.STORE_ADD_TOTAL)
      const afterUploadAddTotal = afterOperationMetrics.find(row => row.name === METRICS_NAMES.UPLOAD_ADD_TOTAL)
      const afterStoreAddSizeTotal = afterOperationMetrics.find(row => row.name === METRICS_NAMES.STORE_ADD_SIZE_TOTAL)
      const spaceAfterUploadAddMetrics = await getSpaceMetrics(t, spaceDid, SPACE_METRICS_NAMES.UPLOAD_ADD_TOTAL)
      const spaceAfterStoreAddMetrics = await getSpaceMetrics(t, spaceDid, SPACE_METRICS_NAMES.STORE_ADD_TOTAL)
      const spaceAfterStoreAddSizeMetrics = await getSpaceMetrics(t, spaceDid, SPACE_METRICS_NAMES.STORE_ADD_SIZE_TOTAL)

      // If staging accept more broad condition given multiple parallel tests can happen there
      if (stage === 'staging') {
        return (
          afterStoreAddTotal?.value >= beforeStoreAddTotal?.value + 1 &&
          afterUploadAddTotal?.value === beforeUploadAddTotal?.value + 1 &&
          afterStoreAddSizeTotal?.value >= beforeStoreAddSizeTotal.value + carSize &&
          spaceAfterStoreAddMetrics?.value >= spaceBeforeStoreAddMetrics?.value + 1 &&
          spaceAfterUploadAddMetrics?.value >= spaceBeforeUploadAddMetrics?.value + 1 &&
          spaceAfterStoreAddSizeMetrics?.value >= spaceBeforeStoreAddSizeMetrics?.value + carSize
        )
      }

      return (
        afterStoreAddTotal?.value === beforeStoreAddTotal?.value + 1 &&
        afterUploadAddTotal?.value === beforeUploadAddTotal?.value + 1 &&
        afterStoreAddSizeTotal?.value === beforeStoreAddSizeTotal.value + carSize &&
        spaceAfterStoreAddMetrics?.value === spaceBeforeStoreAddMetrics?.value + 1 &&
        spaceAfterUploadAddMetrics?.value === spaceBeforeUploadAddMetrics?.value + 1 &&
        spaceAfterStoreAddSizeMetrics?.value === spaceBeforeStoreAddSizeMetrics?.value + carSize
      )
    })
  }
})

/**
 * @param {import("ava").ExecutionContext<import("./helpers/context.js").Context>} t
 */
async function getMetrics (t) {
  const metrics = await getAllTableRows(
    t.context.metricsDynamo.client,
    t.context.metricsDynamo.tableName
  )

  return metrics
}

/**
 * @param {import("ava").ExecutionContext<import("./helpers/context.js").Context>} t
 * @param {`did:${string}:${string}`} spaceDid
 * @param {string} name
 */
async function getSpaceMetrics (t, spaceDid, name) {
  const item = await getTableItem(
    t.context.spaceMetricsDynamo.client,
    t.context.spaceMetricsDynamo.tableName,
    { space: spaceDid, name }
  )

  return item
}
