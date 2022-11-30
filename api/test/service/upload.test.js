import { testStore as test } from '../helpers/context.js'
import { customAlphabet } from 'nanoid'
import { CreateTableCommand, QueryCommand } from '@aws-sdk/client-dynamodb'
import { ListObjectsV2Command } from '@aws-sdk/client-s3'
import { unmarshall } from '@aws-sdk/util-dynamodb'
import * as Signer from '@ucanto/principal/ed25519'
import * as UploadCapabilities from '@web3-storage/access/capabilities/upload'
import { uploadTableProps } from '../../tables/index.js'
import { createS3, createBucket, createAccessServer, createDynamodDb, dynamoDBTableConfig } from '../helpers/resources.js'
import { randomCAR } from '../helpers/random.js'
import { getClientConnection, createSpace } from '../helpers/ucanto.js'

// https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/clients/client-dynamodb/classes/batchwriteitemcommand.html
const BATCH_MAX_SAFE_LIMIT = 25

/**
 * @typedef {import('@ucanto/server')} Server
 * @typedef {import('../../service/types').UploadListItem} UploadItemOutput
 * @typedef {import('../../service/types').ListResponse<UploadItemOutput>} ListResponse
 */

 test.before(async t => {
  // Dynamo DB
  const {
    client: dynamo,
    endpoint: dbEndpoint
  } = await createDynamodDb({ port: 8000 })

  t.context.dbEndpoint = dbEndpoint
  t.context.dynamoClient = dynamo

  // S3
  const { client: s3Client, clientOpts: s3ClientOpts } = await createS3({ port: 9000 })

  t.context.dbEndpoint = dbEndpoint
  t.context.dynamoClient = dynamo
  t.context.s3Client = s3Client
  t.context.s3ClientOpts = s3ClientOpts
})

test.beforeEach(async t => {
  // Access
  const access = await createAccessServer()
  // return a mock info by default
  access.setServiceImpl({
    account: {
      info: async () => ({
        did: (await Signer.generate()).did(),
        agent: (await Signer.generate()).did(),
        email: 'mailto:test@example.com',
        product: 'product:free',
        updated_at: new Date().toISOString(),
        inserted_at: new Date().toISOString()
      })
    }
  })

  t.context.access = access
  t.context.accessServiceDID = access.servicePrincipal.did()
  t.context.accessServiceURL = access.serviceURL.toString()
})

test.afterEach(async t => {
  t.context.access.httpServer.close()
})

test('upload/add inserts into DB mapping between data CID and car CIDs', async (t) => {
  const { tableName, bucketName } = await prepareResources(t.context.dynamoClient, t.context.s3Client)

  const uploadService = await Signer.generate()
  const alice = await Signer.generate()
  const { proof, spaceDid } = await createSpace(alice)
  const connection = await getClientConnection(uploadService, {
    ...t.context,
    tableName,
    bucketName
  })

  const car = await randomCAR(128)
  const otherCar = await randomCAR(40)

  // invoke a upload/add with proof
  const root = car.roots[0]
  const shards = [car.cid, otherCar.cid].sort()

  const uploadAdd = await UploadCapabilities.add.invoke({
    issuer: alice,
    audience: uploadService,
    with: spaceDid,
    nb: { root, shards },
    proofs: [proof]
  }).execute(connection)

  if (uploadAdd.error) {
    throw new Error('invocation failed', { cause: uploadAdd })
  }

  t.like(uploadAdd, { root })

  // order not guaranteed. Sort manually to simplify assertions.
  t.deepEqual(uploadAdd.shards?.sort(), shards)

  // Validate DB
  const dbItems = await getUploadsForSpace(t.context.dynamoClient, tableName, spaceDid)
  t.is(dbItems.length, 1)

  const [dbItem] = dbItems
  t.like(dbItem, {
    space: spaceDid,
    root: root.toString(),
  })

  t.deepEqual([...dbItem.shards].sort(), shards.map(s => s.toString()))

  const msAgo = Date.now() - new Date(dbItems[0].insertedAt).getTime()
  t.true(msAgo < 60_000)
  t.true(msAgo >= 0)

  // Validate data CID -> car CID mapping
  const bucketItems = await getMappingItemsForUpload(t.context.s3Client, bucketName, root.toString())
  for (const shard of shards) {
    t.truthy(bucketItems?.includes(`${root.toString()}/${shard.toString()}`))
  }
})

// TODO: this is current behavior with optional nb.
// We should look into this as a desired behavior
test('upload/add does not fail with no shards provided', async (t) => {
  const { tableName, bucketName } = await prepareResources(t.context.dynamoClient, t.context.s3Client)

  const uploadService = await Signer.generate()
  const alice = await Signer.generate()
  const { proof, spaceDid } = await createSpace(alice)
  const connection = await getClientConnection(uploadService, {
    ...t.context,
    tableName,
    bucketName
  })

  const car = await randomCAR(128)

  // invoke a upload/add with proof
  const root = car.roots[0]

  const uploadAdd = await UploadCapabilities.add.invoke({
    issuer: alice,
    audience: uploadService,
    with: spaceDid,
    nb: { root },
    proofs: [proof]
  }).execute(connection)

  if (uploadAdd.error) {
    throw new Error('invocation failed', { cause: uploadAdd })
  }

  t.like(uploadAdd, {
    root,
    shards: []
  }, 'Should have an empty shards array')

  // Validate DB
  const dbItems = await getUploadsForSpace(t.context.dynamoClient, tableName, spaceDid)
  t.is(dbItems.length, 1)
  const [item] = dbItems
  t.falsy(item.shards)

  // Validate data CID -> car CID mapping
  const bucketItems = await getMappingItemsForUpload(t.context.s3Client, bucketName, root.toString())
  t.is(bucketItems.length, 0)
})

test('upload/add can add shards to an existing item with no shards', async (t) => {
  const { tableName, bucketName } = await prepareResources(t.context.dynamoClient, t.context.s3Client)

  const uploadService = await Signer.generate()
  const alice = await Signer.generate()
  const { proof, spaceDid } = await createSpace(alice)
  const connection = await getClientConnection(uploadService, {
    ...t.context,
    tableName,
    bucketName
  })

  const car = await randomCAR(128)
  const shards = [car.cid]

  // invoke a upload/add with proof
  const root = car.roots[0]

  const uploadAdd1 = await UploadCapabilities.add.invoke({
    issuer: alice,
    audience: uploadService,
    with: spaceDid,
    nb: { root },
    proofs: [proof]
  }).execute(connection)

  if (uploadAdd1.error) {
    throw new Error('invocation failed', { cause: uploadAdd1 })
  }

  t.deepEqual(uploadAdd1.shards, [])

  const uploadAdd2 = await UploadCapabilities.add.invoke({
    issuer: alice,
    audience: uploadService,
    with: spaceDid,
    nb: { root, shards },
    proofs: [proof]
  }).execute(connection)

  if (uploadAdd2.error) {
    throw new Error('invocation failed', { cause: uploadAdd2 })
  }

  t.deepEqual(uploadAdd2.shards, shards)

  // Validate DB
  const dbItems = await getUploadsForSpace(t.context.dynamoClient, tableName, spaceDid)
  t.is(dbItems.length, 1)
  t.deepEqual([...dbItems[0].shards], shards.map(s => s.toString()))
})

test('upload/add merges shards to an existing item with shards', async (t) => {
  const { tableName, bucketName } = await prepareResources(t.context.dynamoClient, t.context.s3Client)

  const uploadService = await Signer.generate()
  const alice = await Signer.generate()
  const { proof, spaceDid } = await createSpace(alice)
  const connection = await getClientConnection(uploadService, {
    ...t.context,
    tableName,
    bucketName
  })

  const cars = await Promise.all([randomCAR(128), randomCAR(128), randomCAR(128)])

  // invoke a upload/add with proof
  const root = cars[2].roots[0]

  const uploadAdd1 = await UploadCapabilities.add.invoke({
    issuer: alice,
    audience: uploadService,
    with: spaceDid,
    nb: { root, shards: [cars[0].cid, cars[1].cid] },
    proofs: [proof]
  }).execute(connection)

  if (uploadAdd1.error) {
    throw new Error('invocation failed', { cause: uploadAdd1 })
  }

  t.deepEqual(uploadAdd1.shards?.sort(), [cars[0].cid, cars[1].cid].sort())

  const uploadAdd2 = await UploadCapabilities.add.invoke({
    issuer: alice,
    audience: uploadService,
    with: spaceDid,
    nb: { root, shards: [cars[1].cid, cars[2].cid] },
    proofs: [proof]
  }).execute(connection)

  if (uploadAdd2.error) {
    throw new Error('invocation failed', { cause: uploadAdd2 })
  }

  t.deepEqual(uploadAdd2?.shards?.sort(), [cars[0].cid, cars[1].cid, cars[2].cid].sort())

  // Validate DB
  const dbItems = await getUploadsForSpace(t.context.dynamoClient, tableName, spaceDid)
  t.is(dbItems.length, 1)

  const [item] = dbItems
  t.like(item, {
    space: spaceDid,
    root: root.toString()
  })
  t.is(item.shards.size, 3, 'Repeated shards should be deduped')
  t.deepEqual([...dbItems[0].shards].sort(), cars.map(c => c.cid.toString()).sort())
})

test('upload/remove does not fail for non existent upload', async (t) => {
  const { tableName, bucketName } = await prepareResources(t.context.dynamoClient, t.context.s3Client)

  const uploadService = await Signer.generate()
  const alice = await Signer.generate()
  const { proof, spaceDid } = await createSpace(alice)
  const connection = await getClientConnection(uploadService, {
    ...t.context,
    tableName,
    bucketName
  })

  const car = await randomCAR(128)

  // invoke a upload/add with proof
  const root = car.roots[0]

  const uploadRemove = await UploadCapabilities.remove.invoke({
    issuer: alice,
    audience: uploadService,
    with: spaceDid,
    nb: { root },
    proofs: [proof]
  }).execute(connection)

  // expect no response for a remove
  t.falsy(uploadRemove)
})

test('upload/remove removes all entries with data CID linked to space', async (t) => {
  const { tableName, bucketName } = await prepareResources(t.context.dynamoClient, t.context.s3Client)

  const uploadService = await Signer.generate()
  const alice = await Signer.generate()
  const { proof: proofSpaceA, spaceDid: spaceDidA } = await createSpace(alice)
  const { proof: proofSpaceB, spaceDid: spaceDidB } = await createSpace(alice)
  const connection = await getClientConnection(uploadService, {
    ...t.context,
    tableName,
    bucketName
  })

  const carA = await randomCAR(128)
  const carB = await randomCAR(40)

  // Invoke two upload/add for spaceA and one upload/add for spaceB

  // Upload CarA to SpaceA
  const uploadAddCarAToSpaceA = await UploadCapabilities.add.invoke({
    issuer: alice,
    audience: uploadService,
    with: spaceDidA,
    nb: { root: carA.roots[0], shards: [carA.cid, carB.cid] },
    proofs: [proofSpaceA]
  }).execute(connection)
  if (uploadAddCarAToSpaceA.error) {
    throw new Error('invocation failed', { cause: uploadAddCarAToSpaceA })
  }

  // Upload CarB to SpaceA
  const uploadAddCarBToSpaceA = await UploadCapabilities.add.invoke({
    issuer: alice,
    audience: uploadService,
    with: spaceDidA,
    nb: { root: carB.roots[0], shards: [carB.cid, carA.cid] },
    proofs: [proofSpaceA]
  }).execute(connection)
  if (uploadAddCarBToSpaceA.error) {
    throw new Error('invocation failed', { cause: uploadAddCarBToSpaceA })
  }

  // Upload CarA to SpaceB
  const uploadAddCarAToSpaceB = await UploadCapabilities.add.invoke({
    issuer: alice,
    audience: uploadService,
    with: spaceDidB,
    nb: { root: carA.roots[0], shards: [carA.cid, carB.cid] },
    proofs: [proofSpaceB]

  }).execute(connection)
  if (uploadAddCarAToSpaceB.error) {
    throw new Error('invocation failed', { cause: uploadAddCarAToSpaceB })
  }

  // Remove CarA from SpaceA
  await UploadCapabilities.remove.invoke({
    issuer: alice,
    audience: uploadService,
    with: spaceDidA,
    nb: { root: carA.roots[0] },
    proofs: [proofSpaceA]
  }).execute(connection)

  const spaceAItems = await getUploadsForSpace(t.context.dynamoClient, tableName, spaceDidA)
  t.falsy(spaceAItems.find((x) => x.root === carA.roots[0].toString()), 'SpaceA should not have upload for carA.root')
  t.truthy(spaceAItems.find((x) => x.root === carB.roots[0].toString()), 'SpaceA should have upload for carB.root')

  const spaceBItems = await getUploadsForSpace(t.context.dynamoClient, tableName, spaceDidB)
  t.falsy(spaceBItems.find((x) => x.root === carB.roots[0].toString()), 'SpaceB should not have upload for carB.root')
  t.truthy(spaceBItems.find((x) => x.root === carA.roots[0].toString()), 'SpaceB should have upload for carA.root')
})

test('upload/remove removes all entries when larger than batch limit', async (t) => {
  const { tableName, bucketName } = await prepareResources(t.context.dynamoClient, t.context.s3Client)

  const uploadService = await Signer.generate()
  const alice = await Signer.generate()
  const { proof, spaceDid } = await createSpace(alice)
  const connection = await getClientConnection(uploadService, {
    ...t.context,
    tableName,
    bucketName
  })

  // create upload with more shards than dynamo batch limit
  const cars = await Promise.all(
    Array.from({ length: BATCH_MAX_SAFE_LIMIT + 1 }).map(() => randomCAR(40))
  )
  const root = cars[0].roots[0]
  const shards = cars.map(c => c.cid)

  const uploadAdd = await UploadCapabilities.add.invoke({
    issuer: alice,
    audience: uploadService,
    with: spaceDid,
    nb: { root, shards },
    proofs: [proof]
  }).execute(connection)

  if (uploadAdd.error) {
    throw new Error('invocation failed', { cause: uploadAdd })
  }
  
  t.is(uploadAdd.shards?.length, shards.length)

  // Validate DB before remove
  const dbItemsBefore = await getUploadsForSpace(t.context.dynamoClient, tableName, spaceDid)
  t.is(dbItemsBefore.length, 1)

  // Remove Car from Space
  await UploadCapabilities.remove.invoke({
    issuer: alice,
    audience: uploadService,
    with: spaceDid,
    nb: { root },
    proofs: [proof]
  }).execute(connection)

  // Validate DB after remove
  const dbItemsAfter = await getUploadsForSpace(t.context.dynamoClient, tableName, spaceDid)
  t.is(dbItemsAfter.length, 0)
})

test('upload/list does not fail for empty list', async (t) => {
  const { tableName, bucketName } = await prepareResources(t.context.dynamoClient, t.context.s3Client)

  const uploadService = await Signer.generate()
  const alice = await Signer.generate()
  const { proof, spaceDid } = await createSpace(alice)
  const connection = await getClientConnection(uploadService, {
    ...t.context,
    tableName,
    bucketName
  })
  
  const uploadList = await UploadCapabilities.list.invoke({
    issuer: alice,
    audience: uploadService,
    with: spaceDid,
    proofs: [ proof ],
    nb: {}
  }).execute(connection)

  t.like(uploadList, { results: [], size: 0 })
})

test('upload/list returns entries previously uploaded by the user', async (t) => {
  const { tableName, bucketName } = await prepareResources(t.context.dynamoClient, t.context.s3Client)

  const uploadService = await Signer.generate()
  const alice = await Signer.generate()
  const { proof, spaceDid } = await createSpace(alice)
  const connection = await getClientConnection(uploadService, {
    ...t.context,
    tableName,
    bucketName
  })

  // invoke multiple upload/add with proof
  const cars = [
    await randomCAR(128),
    await randomCAR(128)
  ]

  for (const car of cars) {
    await UploadCapabilities.add.invoke({
      issuer: alice,
      audience: uploadService,
      with: spaceDid,
      nb: { root: car.roots[0], shards: [car.cid] },
      proofs: [proof]
    }).execute(connection)
  }

  const uploadList = await UploadCapabilities.list.invoke({
    issuer: alice,
    audience: uploadService,
    with: spaceDid,
    proofs: [ proof ],
    nb: {}
  }).execute(connection)
  if (uploadList.error) {
    throw new Error('invocation failed', { cause: uploadList })
  }

  t.is(uploadList.size, cars.length)
  
  for (const car of cars) {
    const root = car.roots[0]
    const item = uploadList.results.find((x) => x.root.toString() === root.toString())
    t.like(item, { root })
    t.deepEqual(item?.shards, [car.cid])
    t.is(item?.updatedAt, item?.insertedAt)
  }
})

test('upload/list can be paginated with custom size', async (t) => {
  const { tableName, bucketName } = await prepareResources(t.context.dynamoClient, t.context.s3Client)

  const uploadService = await Signer.generate()
  const alice = await Signer.generate()
  const { proof, spaceDid } = await createSpace(alice)
  const connection = await getClientConnection(uploadService, {
    ...t.context,
    tableName,
    bucketName
  })

  // invoke multiple upload/add with proof
  const cars = [
    await randomCAR(128),
    await randomCAR(128)
  ]

  for (const car of cars) {
    await UploadCapabilities.add.invoke({
      issuer: alice,
      audience: uploadService,
      with: spaceDid,
      nb: { root: car.roots[0], shards: [car.cid] },
      proofs: [proof]
    }).execute(connection)
  }

  // Get list with page size 1 (two pages)
  const size = 1
  const listPages = []
  let cursor

  do {
    /** @type {import('@ucanto/server').Result<ListResponse, import('@ucanto/server').API.Failure | import('@ucanto/server').HandlerExecutionError | import('@ucanto/server').API.HandlerNotFound | import('@ucanto/server').InvalidAudience | import('@ucanto/server').Unauthorized>} */
    const uploadList = await UploadCapabilities.list.invoke({
      issuer: alice,
      audience: uploadService,
      with: spaceDid,
      proofs: [ proof ],
      nb: {
        size,
        cursor
      }
    }).execute(connection)

    if (uploadList.error) {
      throw new Error('invocation failed', { cause: uploadList })
    }
  
    cursor = uploadList.cursor
    // Add page if it has size
    uploadList.size && listPages.push(uploadList.results)
  } while (cursor)

  t.is(listPages.length, cars.length, 'has number of pages of added CARs')

  // Inspect content
  const uploadList = listPages.flat()
  for (const entry of uploadList) {
    t.truthy(cars.find(car => car.roots[0].toString() === entry.root.toString() ))
  }
})

/**
 * @param {import("@aws-sdk/client-dynamodb").DynamoDBClient} dynamoClient
 * @param {import("@aws-sdk/client-s3").S3Client} s3Client
 */
async function prepareResources (dynamoClient, s3Client) {
  const [ tableName, bucketName ] = await Promise.all([
    createDynamoUploadTable(dynamoClient),
    createBucket(s3Client)
  ])

  return {
    tableName,
    bucketName
  }
}

/**
 * @param {import("@aws-sdk/client-dynamodb").DynamoDBClient} dynamo
 */
 async function createDynamoUploadTable(dynamo) {
  const id = customAlphabet('1234567890abcdefghijklmnopqrstuvwxyz', 10)
  const tableName = id()

  await dynamo.send(new CreateTableCommand({
    TableName: tableName,
    ...dynamoDBTableConfig(uploadTableProps),
    ProvisionedThroughput: {
      ReadCapacityUnits: 1,
      WriteCapacityUnits: 1
    }
  }))

  return tableName
}

/**
 * @param {import("@aws-sdk/client-dynamodb").DynamoDBClient} dynamo
 * @param {string} tableName
 * @param {`did:key:${string}`} spaceDid
 * @param {object} [options]
 * @param {number} [options.limit]
 */
 async function getUploadsForSpace(dynamo, tableName, spaceDid, options = {}) {
  const cmd = new QueryCommand({
    TableName: tableName,
    Limit: options.limit || 30,
    ExpressionAttributeValues: {
      ':u': { S: spaceDid },
    },
    // gotta sidestep dynamo reserved words!?
    ExpressionAttributeNames: {
      '#space': 'space'
    },
    KeyConditionExpression: '#space = :u',
    ProjectionExpression: '#space, root, shards, insertedAt'
  })

  const response = await dynamo.send(cmd)
  return response.Items?.map(i => unmarshall(i)) || []
}

/**
 * @param {import("@aws-sdk/client-s3").S3Client} s3Client
 * @param {string} bucketName
 * @param {string} dataCid
 */
async function getMappingItemsForUpload (s3Client, bucketName, dataCid) {
  const listCmd = new ListObjectsV2Command({
    Bucket: bucketName,
    Prefix: dataCid
  })
  const mappingItems = await s3Client.send(listCmd)

  return mappingItems.Contents?.map(i => i.Key) || []
}
