import { test } from '../helpers/context.js'
import { CID } from 'multiformats/cid'
import * as raw from 'multiformats/codecs/raw'
import { sha256 } from 'multiformats/hashes/sha2'
import { createDynamodDb, createS3, createBucket, createTable } from '../helpers/resources.js'
import { useUploadTable } from '../../tables/upload.js'
import { uploadTableProps, adminMetricsTableProps, spaceMetricsTableProps } from '../../tables/index.js'
import { useMetricsTable as useAdminMetricsStore } from '../../stores/metrics.js'
import { useMetricsTable as useSpaceMetricsStore } from '../../stores/space-metrics.js'

/** @import * as API from '@storacha/upload-api' */

/**
 * Helper to create a CID from a string
 *
 * @param {string} str
 */
async function createCIDFromString(str) {
  const bytes = new TextEncoder().encode(str)
  const hash = await sha256.digest(bytes)
  return CID.create(1, raw.code, hash)
}

/**
 * Helper to create many shard CIDs
 *
 * @param {number} count
 * @returns {Promise<import('@storacha/upload-api').CARLink[]>}
 */
async function createShards(count) {
  const shards = []
  for (let i = 0; i < count; i++) {
    shards.push(await createCIDFromString(`shard-${i}`))
  }
  // @ts-expect-error - using raw codec for testing instead of CAR codec
  return shards
}

/**
 * @param {API.UploadTable} uploadTable 
 * @param {API.DID} space 
 * @param {API.UnknownLink} root 
 * @returns {Promise<API.UnknownLink[]>}
 */
const collectShards = async (uploadTable, space, root) => {
  const shards = []
  /** @type {string|undefined} */
  let cursor
  do {
    const listResult = await uploadTable.listShards(space, root, { cursor })
    if (!listResult.ok) {
      throw new Error('listing shards', { cause: listResult.error })
    }
    shards.push(...listResult.ok.results)
    cursor = listResult.ok.cursor
  } while (cursor)
  return shards
}

test.before(async (t) => {
  Object.assign(t.context, {
    dynamo: await createDynamodDb(),
    s3: (await createS3()).client,
  })
})

test('should store small number of shards inline in DynamoDB', async (t) => {
  const { dynamo, s3 } = t.context
  const uploadShardsBucketName = await createBucket(s3)

  const metrics = {
    space: useSpaceMetricsStore(
      dynamo,
      await createTable(dynamo, spaceMetricsTableProps)
    ),
    admin: useAdminMetricsStore(
      dynamo,
      await createTable(dynamo, adminMetricsTableProps)
    ),
  }

  const uploadTable = useUploadTable(
    dynamo,
    await createTable(dynamo, uploadTableProps),
    metrics,
    {
      s3Client: s3,
      shardsBucketName: uploadShardsBucketName,
    }
  )

  const space = 'did:key:z6MkwDK3M4PxU1FqcSt4quWWc8r9nNa5CvPNPQ1xjJ1Qcvhd'
  const issuer = 'did:key:z6MkwDK3M4PxU1FqcSt4quWWc8r9nNa5CvPNPQ1xjJ1Qcvhd'
  const root = await createCIDFromString('root-1')
  const shards = await createShards(10) // Less than threshold
  const cause = await createCIDFromString('cause-1')

  // Upsert upload
  const upsertResult = await uploadTable.upsert({
    space,
    issuer,
    root,
    shards,
    cause,
  })

  t.truthy(upsertResult.ok)

  const listResult = await uploadTable.listShards(space, root)
  t.truthy(listResult.ok)
  t.is(listResult.ok?.results.length, 10)
})

test('should store large number of shards in S3', async (t) => {
  const { dynamo, s3 } = t.context
  const uploadShardsBucketName = await createBucket(s3)

  const metrics = {
    space: useSpaceMetricsStore(
      dynamo,
      await createTable(dynamo, spaceMetricsTableProps)
    ),
    admin: useAdminMetricsStore(
      dynamo,
      await createTable(dynamo, adminMetricsTableProps)
    ),
  }

  const uploadTable = useUploadTable(
    dynamo,
    await createTable(dynamo, uploadTableProps),
    metrics,
    {
      s3Client: s3,
      shardsBucketName: uploadShardsBucketName,
    }
  )

  const space = 'did:key:z6MkwDK3M4PxU1FqcSt4quWWc8r9nNa5CvPNPQ1xjJ1Qcvhd'
  const issuer = 'did:key:z6MkwDK3M4PxU1FqcSt4quWWc8r9nNa5CvPNPQ1xjJ1Qcvhd'
  const root = await createCIDFromString('root-2')
  const shards = await createShards(6000) // More than threshold (5000)
  const cause = await createCIDFromString('cause-2')

  // Upsert upload
  const upsertResult = await uploadTable.upsert({
    space,
    issuer,
    root,
    shards,
    cause,
  })

  t.truthy(upsertResult.ok)

  const listResults = await collectShards(uploadTable, space, root)
  t.is(listResults.length, 6000)
  // Verify all CIDs are present
  const returnedCidStrings = listResults.map((s) => s.toString()).sort()
  const originalCidStrings = shards.map((s) => s.toString()).sort()
  t.deepEqual(returnedCidStrings, originalCidStrings)
})

test('should migrate from inline to S3 when crossing threshold', async (t) => {
  const { dynamo, s3 } = t.context
  const uploadShardsBucketName = await createBucket(s3)

  const metrics = {
    space: useSpaceMetricsStore(
      dynamo,
      await createTable(dynamo, spaceMetricsTableProps)
    ),
    admin: useAdminMetricsStore(
      dynamo,
      await createTable(dynamo, adminMetricsTableProps)
    ),
  }

  const uploadTable = useUploadTable(
    dynamo,
    await createTable(dynamo, uploadTableProps),
    metrics,
    {
      s3Client: s3,
      shardsBucketName: uploadShardsBucketName,
    }
  )

  const space = 'did:key:z6MkwDK3M4PxU1FqcSt4quWWc8r9nNa5CvPNPQ1xjJ1Qcvhd'
  const issuer = 'did:key:z6MkwDK3M4PxU1FqcSt4quWWc8r9nNa5CvPNPQ1xjJ1Qcvhd'
  const root = await createCIDFromString('root-3')
  const cause = await createCIDFromString('cause-3')

  // First upsert with small number of shards (stored inline)
  const shards1 = await createShards(100)
  const upsert1Result = await uploadTable.upsert({
    space,
    issuer,
    root,
    shards: shards1,
    cause,
  })

  t.truthy(upsert1Result.ok)

  // Second upsert with many more shards (should migrate to S3)
  const shards2 = await createShards(5500)
  const upsert2Result = await uploadTable.upsert({
    space,
    issuer,
    root,
    shards: shards2,
    cause,
  })

  t.truthy(upsert2Result.ok)

  // Get upload to verify all shards are present
  const listResults = await collectShards(uploadTable, space, root)

  // Should have all shards from both upserts, but deduplicated
  t.deepEqual(
    listResults.map(s => s.toString()).sort(),
    [...new Set([...shards1, ...shards2].map(s => s.toString()))].sort(),
  )
})

test('should list uploads with S3-stored shards', async (t) => {
  const { dynamo, s3 } = t.context
  const uploadShardsBucketName = await createBucket(s3)

  const metrics = {
    space: useSpaceMetricsStore(
      dynamo,
      await createTable(dynamo, spaceMetricsTableProps)
    ),
    admin: useAdminMetricsStore(
      dynamo,
      await createTable(dynamo, adminMetricsTableProps)
    ),
  }

  const uploadTable = useUploadTable(
    dynamo,
    await createTable(dynamo, uploadTableProps),
    metrics,
    {
      s3Client: s3,
      shardsBucketName: uploadShardsBucketName,
    }
  )

  const space = 'did:key:z6MkwDK3M4PxU1FqcSt4quWWc8r9nNa5CvPNPQ1xjJ1Qcvhd'
  const issuer = 'did:key:z6MkwDK3M4PxU1FqcSt4quWWc8r9nNa5CvPNPQ1xjJ1Qcvhd'
  const root1 = await createCIDFromString('root-list-1')
  const root2 = await createCIDFromString('root-list-2')
  const cause = await createCIDFromString('cause-list')

  // Create one upload with small shards (inline)
  const shards1 = await createShards(10)
  await uploadTable.upsert({
    space,
    issuer,
    root: root1,
    shards: shards1,
    cause,
  })

  // Create one upload with large shards (S3)
  const shards2 = await createShards(6000)
  await uploadTable.upsert({
    space,
    issuer,
    root: root2,
    shards: shards2,
    cause,
  })

  // List uploads
  const listResult = await uploadTable.list(space)
  t.truthy(listResult.ok)
  t.is(listResult.ok?.results.length, 2)

  // Verify both uploads have their shards
  const upload1 = listResult.ok?.results.find((u) => u.root.toString() === root1.toString())
  const upload2 = listResult.ok?.results.find((u) => u.root.toString() === root2.toString())

  if (!upload1 || !upload2) {
    return t.fail('Missing uploads in list results')
  }

  const upload1Shards = await collectShards(uploadTable, space, upload1.root)
  t.deepEqual(
    upload1Shards.map(s => s.toString()).sort(),
    shards1.map(s => s.toString()).sort(),
  )

  const upload2Shards = await collectShards(uploadTable, space, upload2.root)
  t.deepEqual(
    upload2Shards.map(s => s.toString()).sort(),
    shards2.map(s => s.toString()).sort(),
  )
})

test('should clean up S3 shards when removing upload', async (t) => {
  const { dynamo, s3 } = t.context
  const uploadShardsBucketName = await createBucket(s3)

  const metrics = {
    space: useSpaceMetricsStore(
      dynamo,
      await createTable(dynamo, spaceMetricsTableProps)
    ),
    admin: useAdminMetricsStore(
      dynamo,
      await createTable(dynamo, adminMetricsTableProps)
    ),
  }

  const uploadTable = useUploadTable(
    dynamo,
    await createTable(dynamo, uploadTableProps),
    metrics,
    {
      s3Client: s3,
      shardsBucketName: uploadShardsBucketName,
    }
  )

  const space = 'did:key:z6MkwDK3M4PxU1FqcSt4quWWc8r9nNa5CvPNPQ1xjJ1Qcvhd'
  const issuer = 'did:key:z6MkwDK3M4PxU1FqcSt4quWWc8r9nNa5CvPNPQ1xjJ1Qcvhd'
  const root = await createCIDFromString('root-remove')
  const shards = await createShards(6000)
  const cause = await createCIDFromString('cause-remove')

  // Upsert upload with many shards (stored in S3)
  await uploadTable.upsert({
    space,
    issuer,
    root,
    shards,
    cause,
  })

  // Remove upload
  const removeResult = await uploadTable.remove(space, root)
  t.truthy(removeResult.ok)

  // Verify upload is gone
  const getResult = await uploadTable.get(space, root)
  t.truthy(getResult.error)

  // Should error because upload is not found
  const listResult = await uploadTable.listShards(space, root)
  t.truthy(listResult.error)
})
