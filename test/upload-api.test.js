import { fetch } from '@web-std/fetch'
import git from 'git-rev-sync'
import { HeadObjectCommand } from '@aws-sdk/client-s3'

import { test } from './helpers/context.js'
import {
  stage,
  getApiEndpoint,
  getCloudflareBucketClient,
} from './helpers/deployment.js'
import { getClient } from './helpers/up-client.js'
import { randomFile } from './helpers/random.js'

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
  const apiEndpoint = getApiEndpoint()
  const client = await getClient(apiEndpoint)
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
})
