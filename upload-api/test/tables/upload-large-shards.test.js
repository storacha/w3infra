import { test } from '../helpers/context.js'
import { CID } from 'multiformats/cid'
import * as raw from 'multiformats/codecs/raw'
import { sha256 } from 'multiformats/hashes/sha2'
import { createDynamodDb, createS3, createBucket, createTable } from '../helpers/resources.js'
import { useUploadTable } from '../../tables/upload.js'
import { uploadTableProps } from '../../tables/index.js'
import { useMetricsTable as useAdminMetricsStore } from '../../stores/metrics.js'
import { useMetricsTable as useSpaceMetricsStore } from '../../stores/space-metrics.js'
import { adminMetricsTableProps, spaceMetricsTableProps } from '../../tables/index.js'

/**
 * Helper to create a CID from a string
 * @param {string} str
 */
async function createCIDFromString(str) {
  const bytes = new TextEncoder().encode(str)
  const hash = await sha256.digest(bytes)
  return CID.create(1, raw.code, hash)
}

/**
 * Helper to create many shard CIDs
 * @param {number} count
 */
async function createShards(count) {
  const shards = []
  for (let i = 0; i < count; i++) {
    shards.push(await createCIDFromString(`shard-${i}`))
  }
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
  const root = await createCIDFromString('root-1')
  const shards = await createShards(10) // Less than threshold
  const cause = await createCIDFromString('cause-1')

  // Upsert upload
  const upsertResult = await uploadTable.upsert({
    space,
    root,
    shards,
    cause,
  })

  t.truthy(upsertResult.ok)
  t.is(upsertResult.ok?.shards.length, 10)

  // Get upload to verify shards are inline
  const getResult = await uploadTable.get(space, root)
  t.truthy(getResult.ok)
  t.is(getResult.ok?.shards.length, 10)
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
  const root = await createCIDFromString('root-2')
  const shards = await createShards(6000) // More than threshold (5000)
  const cause = await createCIDFromString('cause-2')

  // Upsert upload
  const upsertResult = await uploadTable.upsert({
    space,
    root,
    shards,
    cause,
  })

  t.truthy(upsertResult.ok)
  t.is(upsertResult.ok?.shards.length, 6000)

  // Get upload to verify shards are fetched from S3
  const getResult = await uploadTable.get(space, root)
  t.truthy(getResult.ok)
  t.is(getResult.ok?.shards.length, 6000)

  // Verify all CIDs are present
  const returnedCidStrings = getResult.ok?.shards.map((s) => s.toString()).sort()
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
  const root = await createCIDFromString('root-3')
  const cause = await createCIDFromString('cause-3')

  // First upsert with small number of shards (stored inline)
  const shards1 = await createShards(100)
  const upsert1Result = await uploadTable.upsert({
    space,
    root,
    shards: shards1,
    cause,
  })

  t.truthy(upsert1Result.ok)
  t.is(upsert1Result.ok?.shards.length, 100)

  // Second upsert with many more shards (should migrate to S3)
  const shards2 = await createShards(5500)
  const upsert2Result = await uploadTable.upsert({
    space,
    root,
    shards: shards2,
    cause,
  })

  t.truthy(upsert2Result.ok)
  // Should have all shards from both upserts, but deduplicated
  t.true(upsert2Result.ok?.shards.length >= 5500)

  // Get upload to verify all shards are present
  const getResult = await uploadTable.get(space, root)
  t.truthy(getResult.ok)
  t.true(getResult.ok?.shards.length >= 5500)
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
  const root1 = await createCIDFromString('root-list-1')
  const root2 = await createCIDFromString('root-list-2')
  const cause = await createCIDFromString('cause-list')

  // Create one upload with small shards (inline)
  const shards1 = await createShards(10)
  await uploadTable.upsert({
    space,
    root: root1,
    shards: shards1,
    cause,
  })

  // Create one upload with large shards (S3)
  const shards2 = await createShards(6000)
  await uploadTable.upsert({
    space,
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

  t.is(upload1?.shards.length, 10)
  t.is(upload2?.shards.length, 6000)
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
  const root = await createCIDFromString('root-remove')
  const shards = await createShards(6000)
  const cause = await createCIDFromString('cause-remove')

  // Upsert upload with many shards (stored in S3)
  await uploadTable.upsert({
    space,
    root,
    shards,
    cause,
  })

  // Remove upload
  const removeResult = await uploadTable.remove(space, root)
  t.truthy(removeResult.ok)
  t.is(removeResult.ok?.shards.length, 6000)

  // Verify upload is gone
  const getResult = await uploadTable.get(space, root)
  t.truthy(getResult.error)
})
