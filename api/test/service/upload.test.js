import { testStore as test } from '../helpers/context.js'
import { CreateTableCommand, QueryCommand } from '@aws-sdk/client-dynamodb'
import { unmarshall } from '@aws-sdk/util-dynamodb'
import * as Signer from '@ucanto/principal/ed25519'
import * as UploadCapabilities from '@web3-storage/access/capabilities/upload'

import getServiceDid from '../../authority.js'
import { BATCH_MAX_SAFE_LIMIT } from '../../tables/upload.js'

import { createDynamodDb } from '../utils.js'
import { randomCAR } from '../helpers/random.js'
import { getClientConnection, createSpace } from '../helpers/ucanto.js'

test.beforeEach(async t => {
  const region = 'us-west-2'
  const tableName = 'upload'

  // Dynamo DB
  const {
    client: dynamo,
    endpoint: dbEndpoint
  } = await createDynamodDb({ port: 8000, region })
  await createDynamoUploadTable(dynamo)

  t.context.dbEndpoint = dbEndpoint
  t.context.dynamoClient = dynamo
  t.context.tableName = tableName
  t.context.region = region
  t.context.serviceDid = await getServiceDid()
})

test('upload/add inserts into DB mapping between data CID and car CIDs', async (t) => {
  const uploadService = t.context.serviceDid
  const alice = await Signer.generate()
  const { proof, spaceDid } = await createSpace(alice)
  const connection = await getClientConnection(uploadService, t.context)

  const car = await randomCAR(128)
  const otherCar = await randomCAR(40)

  // invoke a upload/add with proof
  const root = car.roots[0]
  const shards = [car.cid, otherCar.cid]

  /** @type {import('../../service/types').UploadItemOutput[]} */
  const uploadAdd = await UploadCapabilities.add.invoke({
    issuer: alice,
    audience: uploadService,
    with: spaceDid,
    nb: { root, shards },
    proofs: [proof]
    // @ts-expect-error ʅʕ•ᴥ•ʔʃ
  }).execute(connection)

  // @ts-expect-error error is added by ucanto if it fails
  t.not(uploadAdd.error, true, uploadAdd.message)
  t.is(uploadAdd.length, shards.length)

  // Validate shards result
  for (const shard of shards) {
    const shardResult = uploadAdd.find((s) => s.carCID === shard.toString())
    t.is(shardResult?.dataCID, root.toString())
    t.is(shardResult?.uploaderDID, spaceDid)
    t.truthy(shardResult?.uploadedAt)
  }

  // Validate DB
  const dbItems = await getSpaceItems(t.context.dynamoClient, spaceDid)
  t.is(dbItems.length, shards.length)

  // Validate shards result
  for (const shard of shards) {
    const shardResult = dbItems.find((s) => s.carCID === shard.toString())
    t.is(shardResult?.dataCID, root.toString())
    t.truthy(shardResult?.uploadedAt)
  }
})

// TODO: this is current behavior with optional nb.
// We should look into this as a desired behavior
test('upload/add does not fail with no shards provided', async (t) => {
  const uploadService = t.context.serviceDid
  const alice = await Signer.generate()
  const { proof, spaceDid } = await createSpace(alice)
  const connection = await getClientConnection(uploadService, t.context)

  const car = await randomCAR(128)

  // invoke a upload/add with proof
  const root = car.roots[0]

  /** @type {import('../../service/types').UploadItemOutput[]} */
  const uploadAdd = await UploadCapabilities.add.invoke({
    issuer: alice,
    audience: uploadService,
    with: spaceDid,
    nb: { root },
    proofs: [proof]
    // @ts-expect-error ʅʕ•ᴥ•ʔʃ
  }).execute(connection)

  // @ts-expect-error error is added by ucanto if it fails
  t.not(uploadAdd.error, true, uploadAdd.message)
  t.is(uploadAdd.length, 0)

  // Validate DB
  const dbItems = await getSpaceItems(t.context.dynamoClient, spaceDid)
  t.is(dbItems.length, 0)
})

test('upload/remove does not fail for non existent upload', async (t) => {
  const uploadService = t.context.serviceDid
  const alice = await Signer.generate()
  const { proof, spaceDid } = await createSpace(alice)
  const connection = await getClientConnection(uploadService, t.context)

  const car = await randomCAR(128)

  // invoke a upload/add with proof
  const root = car.roots[0]

  const uploadRemove = await UploadCapabilities.remove.invoke({
    issuer: alice,
    audience: uploadService,
    with: spaceDid,
    nb: { root },
    proofs: [proof]
    // @ts-expect-error ʅʕ•ᴥ•ʔʃ
  }).execute(connection)

  // expect no response for a remove
  t.falsy(uploadRemove)
})

test('upload/remove removes all entries with data CID linked to space', async (t) => {
  const uploadService = t.context.serviceDid
  const alice = await Signer.generate()
  const { proof: proofSpaceA, spaceDid: spaceDidA } = await createSpace(alice)
  const { proof: proofSpaceB, spaceDid: spaceDidB } = await createSpace(alice)
  const connection = await getClientConnection(uploadService, t.context)

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
    // @ts-expect-error ʅʕ•ᴥ•ʔʃ
  }).execute(connection)
  t.not(uploadAddCarAToSpaceA.error, true, uploadAddCarAToSpaceA.message)

  // Upload CarB to SpaceA
  const uploadAddCarBToSpaceA = await UploadCapabilities.add.invoke({
    issuer: alice,
    audience: uploadService,
    with: spaceDidA,
    nb: { root: carB.roots[0], shards: [carB.cid, carA.cid] },
    proofs: [proofSpaceA]
    // @ts-expect-error ʅʕ•ᴥ•ʔʃ
  }).execute(connection)
  t.not(uploadAddCarBToSpaceA.error, true, uploadAddCarBToSpaceA.message)

  // Upload CarA to SpaceB
  const uploadAddCarAToSpaceB = await UploadCapabilities.add.invoke({
    issuer: alice,
    audience: uploadService,
    with: spaceDidB,
    nb: { root: carA.roots[0], shards: [carA.cid, carB.cid] },
    proofs: [proofSpaceB]
    // @ts-expect-error ʅʕ•ᴥ•ʔʃ
  }).execute(connection)
  t.not(uploadAddCarAToSpaceB.error, true, uploadAddCarAToSpaceB.message)

  // Remove CarA from SpaceA
  await UploadCapabilities.remove.invoke({
    issuer: alice,
    audience: uploadService,
    with: spaceDidA,
    nb: { root: carA.roots[0] },
    proofs: [proofSpaceA]
    // @ts-expect-error ʅʕ•ᴥ•ʔʃ
  }).execute(connection)

  // Validate SpaceA has 0 items for CarA
  const spaceAcarAItems = await getSpaceItemsFilteredByDataCID(t.context.dynamoClient, spaceDidA, carA.roots[0])
  t.is(spaceAcarAItems.length, 0)

  // Validate SpaceA has 2 items for CarB
  const spaceAcarBItems = await getSpaceItemsFilteredByDataCID(t.context.dynamoClient, spaceDidA, carB.roots[0])
  t.is(spaceAcarBItems.length, 2)

  // Validate SpaceB has 2 items for CarA
  const spaceBcarAItems = await getSpaceItemsFilteredByDataCID(t.context.dynamoClient, spaceDidB, carA.roots[0])
  t.is(spaceBcarAItems.length, 2)
})

test('upload/remove removes all entries when larger than batch limit', async (t) => {
  const uploadService = t.context.serviceDid
  const alice = await Signer.generate()
  const { proof, spaceDid } = await createSpace(alice)
  const connection = await getClientConnection(uploadService, t.context)

  // create upload with more shards than dynamo batch limit
  const cars = await Promise.all(
    Array.from({ length: BATCH_MAX_SAFE_LIMIT + 1 }).map(() => randomCAR(40))
  )
  const root = cars[0].roots[0]
  const shards = cars.map(c => c.cid)

  /** @type {import('../../service/types').UploadItemOutput[]} */
  const uploadAdd = await UploadCapabilities.add.invoke({
    issuer: alice,
    audience: uploadService,
    with: spaceDid,
    nb: { root, shards },
    proofs: [proof]
    // @ts-expect-error ʅʕ•ᴥ•ʔʃ
  }).execute(connection)

  // @ts-expect-error error is added by ucanto if it fails
  t.not(uploadAdd.error, true, uploadAdd.message)
  t.is(uploadAdd.length, shards.length)

  // Validate DB before remove
  const dbItemsBefore = await getSpaceItems(t.context.dynamoClient, spaceDid)
  t.is(dbItemsBefore.length, shards.length)

  // Remove Car from Space
  await UploadCapabilities.remove.invoke({
    issuer: alice,
    audience: uploadService,
    with: spaceDid,
    nb: { root },
    proofs: [proof]
    // @ts-expect-error ʅʕ•ᴥ•ʔʃ
  }).execute(connection)

  // Validate DB after remove
  const dbItemsAfter = await getSpaceItems(t.context.dynamoClient, spaceDid)
  t.is(dbItemsAfter.length, 0)
})

test('store/list does not fail for empty list', async (t) => {
  const uploadService = t.context.serviceDid
  const alice = await Signer.generate()
  const { proof, spaceDid } = await createSpace(alice)
  const connection = await getClientConnection(uploadService, t.context)
  
  const uploadList = await UploadCapabilities.list.invoke({
    issuer: alice,
    audience: uploadService,
    with: spaceDid,
    proofs: [ proof ]
    // @ts-expect-error ʅʕ•ᴥ•ʔʃ
  }).execute(connection)

  t.like(uploadList, { results: [], pageSize: 0 })
})

test('store/list returns entries previously uploaded by the user', async (t) => {
  const uploadService = t.context.serviceDid
  const alice = await Signer.generate()
  const { proof, spaceDid } = await createSpace(alice)
  const connection = await getClientConnection(uploadService, t.context)

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
      // @ts-expect-error ʅʕ•ᴥ•ʔʃ
    }).execute(connection)
  }

  /** @type {import('../../service/types').ListResponse<import('../../service/types').UploadItemOutput>} */
  const uploadList = await UploadCapabilities.list.invoke({
    issuer: alice,
    audience: uploadService,
    with: spaceDid,
    proofs: [ proof ]
    // @ts-expect-error ʅʕ•ᴥ•ʔʃ
  }).execute(connection)

  t.is(uploadList.pageSize, cars.length)

  // Validate entries have given CARs
  for (const entry of uploadList.results) {
    t.truthy(cars.find(car => car.roots[0].toString() === entry.dataCID ))
  }
})

/**
 * @param {import("@aws-sdk/client-dynamodb").DynamoDBClient} dynamo
 */
 async function createDynamoUploadTable(dynamo) {
  await dynamo.send(new CreateTableCommand({
    TableName: 'upload',
    AttributeDefinitions: [
      { AttributeName: 'uploaderDID', AttributeType: 'S' },
      { AttributeName: 'sk', AttributeType: 'S' }
    ],
    KeySchema: [
      { AttributeName: 'uploaderDID', KeyType: 'HASH' },
      { AttributeName: 'sk', KeyType: 'RANGE' },
    ],
    ProvisionedThroughput: {
      ReadCapacityUnits: 1,
      WriteCapacityUnits: 1
    }
  }))
}

/**
 * @param {import("@aws-sdk/client-dynamodb").DynamoDBClient} dynamo
 * @param {`did:key:${string}`} spaceDid
 */
 async function getSpaceItems(dynamo, spaceDid) {
  const cmd = new QueryCommand({
    TableName: 'upload',
    Limit: 30,
    ExpressionAttributeValues: {
      ':u': { S: spaceDid },
    },  
    KeyConditionExpression: 'uploaderDID = :u',
    ProjectionExpression: 'dataCID, carCID, uploadedAt'
  })

  const response = await dynamo.send(cmd)
  return response.Items?.map(i => unmarshall(i)) || []
}

/**
 * @param {import("@aws-sdk/client-dynamodb").DynamoDBClient} dynamo
 * @param {`did:key:${string}`} spaceDid
 * @param {import("multiformats").CID<unknown, 85, 18, 1>} dataCid
 */
 async function getSpaceItemsFilteredByDataCID(dynamo, spaceDid, dataCid) {
  const cmd = new QueryCommand({
    TableName: 'upload',
    Limit: 30,
    ExpressionAttributeValues: {
      ':u': { S: spaceDid },
      ':d': { S: dataCid.toString() }
    },  
    KeyConditionExpression: 'uploaderDID = :u',
    FilterExpression: 'contains (dataCID, :d)',
    ProjectionExpression: 'dataCID, carCID, uploadedAt'
  })

  const response = await dynamo.send(cmd)
  return response.Items?.map(i => unmarshall(i)) || []
}

