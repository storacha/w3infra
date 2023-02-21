import { fetch } from '@web-std/fetch'
import git from 'git-rev-sync'
import pWaitFor from 'p-wait-for'
import { HeadObjectCommand } from '@aws-sdk/client-s3'

import { W3_METRICS_NAMES } from '../ucan-invocation/constants.js'
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
import { getClient } from './helpers/up-client.js'
import { randomFile } from './helpers/random.js'
import { getAllTableRows } from './helpers/table.js'

test.before(t => {
  t.context = {
    apiEndpoint: getApiEndpoint(),
    w3MetricsDynamo: getDynamoDb('w3-metrics')
  }
})

test('GET /', async t => {
  const apiEndpoint = getApiEndpoint()
  const response = await fetch(apiEndpoint)
  t.is(response.status, 200)
})

test('GET /version', async t => {
  const apiEndpoint = getApiEndpoint()

  const response = await fetch(`${apiEndpoint}/version`)
  t.is(response.status, 200)

  const body = await response.json()
  t.is(body.env, stage)
  t.is(body.commit, git.long('.'))
})

test('POST / client can upload a file and list it', async t => {
  const client = await getClient(t.context.apiEndpoint)

  // Get metrics before upload
  const beforeOperationW3Metrics = await getW3Metrics(t)
  const beforeW3AccumulatedSize = beforeOperationW3Metrics.find(row => row.name === W3_METRICS_NAMES.STORE_ADD_ACCUM_SIZE)

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
    } catch {}

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
    } catch {}

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
    } catch {}

    return satnav?.$metadata.httpStatusCode === 200
  }, {
    interval: 100,
  })

  // Check metrics were updated
  beforeW3AccumulatedSize && await pWaitFor(async () => {
    const afterOperationW3Metrics = await getW3Metrics(t)
    const afterW3AccumulatedSize = afterOperationW3Metrics.find(row => row.name === W3_METRICS_NAMES.STORE_ADD_ACCUM_SIZE)

    return afterW3AccumulatedSize?.value > beforeW3AccumulatedSize.value
  })
})

/**
 * @param {import("ava").ExecutionContext<import("./helpers/context.js").Context>} t
 */
async function getW3Metrics (t) {
  const w3Metrics = await getAllTableRows(
    t.context.w3MetricsDynamo.client,
    t.context.w3MetricsDynamo.tableName
  )

  return w3Metrics
}
