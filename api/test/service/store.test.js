import { testStore as test } from '../helpers/context.js'
import { customAlphabet } from 'nanoid'
import { CreateTableCommand, GetItemCommand } from '@aws-sdk/client-dynamodb'
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb'
import { PutObjectCommand } from '@aws-sdk/client-s3'
import * as Signer from '@ucanto/principal/ed25519'
import { CAR } from '@ucanto/transport'
import * as Server from '@ucanto/server'
import * as StoreCapabilities from '@web3-storage/access/capabilities/store'
import { base64pad } from 'multiformats/bases/base64'
import { getClientConnection, createSpace } from '../helpers/ucanto.js'
import { createS3, createBucket, createDynamodDb, createAccessServer } from '../utils.js'
import { dynamoDBTableConfig, storeTableProps } from '../../tables/index.js'

/**
 * @typedef {import('../../service/types').StoreListResult} StoreListResult
 * @typedef {import('../../service/types').ListResponse<StoreListResult>} ListResponse
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

test('store/add returns signed url for uploading', async (t) => {
  const { tableName, bucketName } = await prepareResources(t.context.dynamoClient, t.context.s3Client)

  const uploadService = await Signer.generate()
  const alice = await Signer.generate()
  const { proof, spaceDid } = await createSpace(alice)
  const connection = await getClientConnection(uploadService, {
    ...t.context,
    tableName,
    bucketName
  })

  const data = new Uint8Array([11, 22, 34, 44, 55])
  const link = await CAR.codec.link(data)

  // invoke a store/add with proof
  const storeAdd = await StoreCapabilities.add.invoke({
    issuer: alice,
    audience: uploadService,
    with: spaceDid,
    nb: { link, size: data.byteLength },
    proofs: [proof]
  }).execute(connection)

  if (storeAdd.error) {
    throw new Error('invocation failed', { cause: storeAdd })
  }

  t.is(storeAdd.status, 'upload')
  t.is(storeAdd.with, spaceDid)
  t.deepEqual(storeAdd.link, link)
  t.is(storeAdd.url && new URL(storeAdd.url).pathname, `/${link}/${link}.car`)
  t.is(storeAdd.headers && storeAdd.headers['x-amz-checksum-sha256'], base64pad.baseEncode(link.multihash.digest))

  const item = await getItemFromStoreTable(t.context.dynamoClient, tableName, spaceDid, link)
  t.truthy(item)
  t.is(typeof item?.insertedAt, 'string')
  t.is(typeof item?.space, 'string')
  t.is(item?.space, spaceDid)
  t.is(typeof item?.size, 'number')
  t.is(item?.size, data.byteLength)
})

test('store/add returns done if already uploaded', async (t) => {
  const { tableName, bucketName } = await prepareResources(t.context.dynamoClient, t.context.s3Client)

  const uploadService = await Signer.generate()
  const alice = await Signer.generate()
  const { proof, spaceDid } = await createSpace(alice)
  const connection = await getClientConnection(uploadService, {
    ...t.context,
    tableName,
    bucketName
  })

  const data = new Uint8Array([11, 22, 34, 44, 55])
  const link = await CAR.codec.link(data)

  // simulate an already stored CAR
  await t.context.s3Client.send(
    new PutObjectCommand({
      Bucket: bucketName,
      Key: `${link}/${link}.car`,
      Body: data,
    })
  )

  const storeAdd = await StoreCapabilities.add.invoke({
    issuer: alice,
    audience: uploadService,
    with: spaceDid,
    nb: { link, size: data.byteLength },
    proofs: [proof]
  }).execute(connection)

  if (storeAdd.error) {
    throw new Error('invocation failed', { cause: storeAdd })
  }

  t.is(storeAdd.status, 'done')
  t.is(storeAdd.with, spaceDid)
  t.deepEqual(storeAdd.link, link)
  t.falsy(storeAdd.url)

  // Even if done (CAR already exists in bucket), mapped to user if non existing
  const item = await getItemFromStoreTable(t.context.dynamoClient, tableName, spaceDid, link)
  t.like(item, {
    space: spaceDid,
    car: link.toString(),
    size: data.byteLength,
    agent: alice.did(),
  })
  t.is(typeof item?.ucan, 'string')
  t.is(typeof item?.insertedAt, 'string')
})

test('store/add allowed if invocation passes access verification', async (t) => {
  const { tableName, bucketName } = await prepareResources(t.context.dynamoClient, t.context.s3Client)

  const uploadService = await Signer.generate()
  const alice = await Signer.generate()
  const { proof, spaceDid } = await createSpace(alice)
  const connection = await getClientConnection(uploadService, {
    ...t.context,
    tableName,
    bucketName
  })

  const data = new Uint8Array([11, 22, 34, 44, 55])
  const link = await CAR.codec.link(data)

  // invoke a store/add with proof
  const storeAdd = await StoreCapabilities.add.invoke({
    issuer: alice,
    audience: uploadService,
    with: spaceDid,
    nb: { link, size: data.byteLength },
    proofs: [proof]
  }).execute(connection)

  if (storeAdd.error) {
    throw new Error('invocation failed', { cause: storeAdd })
  }

  t.is(storeAdd.status, 'upload')
  t.is(storeAdd.with, spaceDid)
  t.deepEqual(storeAdd.link, link)
  t.is(storeAdd.url && new URL(storeAdd.url).pathname, `/${link}/${link}.car`)
  t.is(storeAdd.headers && storeAdd.headers['x-amz-checksum-sha256'], base64pad.baseEncode(link.multihash.digest))

  const { service } = t.context.access.server
  t.true(service.space.info.called)
  t.is(service.space.info.callCount, 1)
})

test('store/add disallowed if invocation fails access verification', async (t) => {
  const { tableName, bucketName } = await prepareResources(t.context.dynamoClient, t.context.s3Client)

  t.context.access.setServiceImpl({
    account: { info: () => { return new Server.Failure('not found') } }
  })

  const uploadService = await Signer.generate()
  const alice = await Signer.generate()
  const { proof, spaceDid } = await createSpace(alice)
  const connection = await getClientConnection(uploadService, {
    ...t.context,
    tableName,
    bucketName
  })

  const data = new Uint8Array([11, 22, 34, 44, 55])
  const link = await CAR.codec.link(data)

  // invoke a store/add with proof
  const storeAdd = await StoreCapabilities.add.invoke({
    issuer: alice,
    audience: uploadService,
    with: spaceDid,
    nb: { link, size: data.byteLength },
    proofs: [proof]
  }).execute(connection)

  t.is(storeAdd.error, true)

  const { service } = t.context.access.server
  t.true(service.space.info.called)
  t.is(service.space.info.callCount, 1)
})

test('store/remove does not fail for non existent link', async (t) => {
  const { tableName, bucketName } = await prepareResources(t.context.dynamoClient, t.context.s3Client)

  const uploadService = await Signer.generate()
  const alice = await Signer.generate()
  const { proof, spaceDid } = await createSpace(alice)
  const connection = await getClientConnection(uploadService, {
    ...t.context,
    tableName,
    bucketName
  })

  const data = new Uint8Array([11, 22, 34, 44, 55])
  const link = await CAR.codec.link(data)

  const storeRemove = await StoreCapabilities.remove.invoke({
    issuer: alice,
    audience: uploadService,
    with: spaceDid,
    nb: { link },
    proofs: [proof]
  }).execute(connection)

  // expect no response for a remove
  t.falsy(storeRemove)

  const storeRemove2 = await StoreCapabilities.remove.invoke({
    issuer: alice,
    audience: uploadService,
    with: spaceDid,
    nb: { link },
    proofs: [proof]
  }).execute(connection)

  // expect no response for a remove
  t.falsy(storeRemove2)
})

test('store/remove removes car bound to issuer from store table', async (t) => {
  const { tableName, bucketName } = await prepareResources(t.context.dynamoClient, t.context.s3Client)

  const uploadService = await Signer.generate()
  const alice = await Signer.generate()
  const { proof, spaceDid } = await createSpace(alice)
  const connection = await getClientConnection(uploadService, {
    ...t.context,
    tableName,
    bucketName
  })

  const data = new Uint8Array([11, 22, 34, 44, 55])
  const link = await CAR.codec.link(data)

  // Validate Store Table content does not exist before add
  const dynamoItemBeforeAdd = await getItemFromStoreTable(t.context.dynamoClient, tableName, spaceDid, link)
  t.falsy(dynamoItemBeforeAdd)

  const storeAdd = await StoreCapabilities.add.invoke({
    issuer: alice,
    audience: uploadService,
    with: spaceDid,
    nb: { link, size: data.byteLength },
    proofs: [proof]
  }).execute(connection)

  if (storeAdd.error) {
    throw new Error('invocation failed', { cause: storeAdd })
  }

  t.is(storeAdd.status, 'upload')

  // Validate Store Table content exists after add
  const dynamoItemAfterAdd = await getItemFromStoreTable(t.context.dynamoClient, tableName, spaceDid, link)
  t.truthy(dynamoItemAfterAdd)

  const storeRemove = await StoreCapabilities.remove.invoke({
    issuer: alice,
    audience: uploadService,
    with: spaceDid,
    nb: { link },
    proofs: [proof]
  }).execute(connection)

  t.falsy(storeRemove)

  // Validate Store Table content does not exist after remove
  const dynamoItemAfterRemove = await getItemFromStoreTable(t.context.dynamoClient, tableName, spaceDid, link)
  t.falsy(dynamoItemAfterRemove)
})

test('store/list does not fail for empty list', async (t) => {
  const { tableName, bucketName } = await prepareResources(t.context.dynamoClient, t.context.s3Client)

  const uploadService = await Signer.generate()
  const alice = await Signer.generate()
  const { proof, spaceDid } = await createSpace(alice)
  const connection = await getClientConnection(uploadService, {
    ...t.context,
    tableName,
    bucketName
  })
  
  const storeList = await StoreCapabilities.list.invoke({
    issuer: alice,
    audience: uploadService,
    with: spaceDid,
    proofs: [ proof ],
    nb: {}
  }).execute(connection)

  t.like(storeList, { results: [], size: 0 })
})

test('store/list returns items previously stored by the user', async (t) => {
  const { tableName, bucketName } = await prepareResources(t.context.dynamoClient, t.context.s3Client)

  const uploadService = await Signer.generate()
  const alice = await Signer.generate()
  const { proof, spaceDid } = await createSpace(alice)
  const connection = await getClientConnection(uploadService, {
    ...t.context,
    tableName,
    bucketName
  })

  const data = [ new Uint8Array([11, 22, 34, 44, 55]), new Uint8Array([22, 34, 44, 55, 66]) ]
  const links = []
  for (const datum of data) {
    const storeAdd = await StoreCapabilities.add.invoke({
      issuer: alice,
      audience: uploadService,
      with: spaceDid,
      nb: { link: await CAR.codec.link(datum) , size: datum.byteLength },
      proofs: [proof]
    }).execute(connection)
    if (storeAdd.error) {
      throw new Error('invocation failed', { cause: storeAdd })
    }

    t.is(storeAdd.status, 'upload')
    links.push(storeAdd.link)
  }

  const storeList = await StoreCapabilities.list.invoke({
    issuer: alice,
    audience: uploadService,
    with: spaceDid,
    proofs: [ proof ],
    nb: {}
  }).execute(connection)

  if (storeList.error) {
    throw new Error('invocation failed', { cause: storeList })
  }

  t.is(storeList.size, links.length)

  // list order last-in-first-out
  links.reverse()
  let i = 0
  for (const entry of storeList.results) {
    t.like(entry, { car: links[i].toString(), size: 5 })
    i++
  }
})

test('store/list can be paginated with custom size', async (t) => {
  const { tableName, bucketName } = await prepareResources(t.context.dynamoClient, t.context.s3Client)

  const uploadService = await Signer.generate()
  const alice = await Signer.generate()
  const { proof, spaceDid } = await createSpace(alice)
  const connection = await getClientConnection(uploadService, {
    ...t.context,
    tableName,
    bucketName
  })

  const data = [ new Uint8Array([11, 22, 34, 44, 55]), new Uint8Array([22, 34, 44, 55, 66]) ]
  const links = []

  for (const datum of data) {
    const storeAdd = await StoreCapabilities.add.invoke({
      issuer: alice,
      audience: uploadService,
      with: spaceDid,
      nb: { link: await CAR.codec.link(datum) , size: datum.byteLength },
      proofs: [proof]
    }).execute(connection)
    if (storeAdd.error) {
      throw new Error('invocation failed', { cause: storeAdd })
    }

    links.push(storeAdd.link)
  }

  // Get list with page size 1 (two pages)
  const size = 1
  const listPages = []
  let cursor

  do {
    /** @type {Server.Result<ListResponse, Server.API.Failure | Server.HandlerExecutionError | Server.API.HandlerNotFound | Server.InvalidAudience | Server.Unauthorized>} */
    const storeList = await StoreCapabilities.list.invoke({
      issuer: alice,
      audience: uploadService,
      with: spaceDid,
      proofs: [ proof ],
      nb: {
        size,
        cursor
      }
    }).execute(connection)

    if (storeList.error) {
      throw new Error('invocation failed', { cause: storeList })
    }
  
    cursor = storeList.cursor
    // Add page if it has size
    storeList.size && listPages.push(storeList.results)
  } while (cursor)

  t.is(listPages.length, data.length, 'has number of pages of added CARs')

  // Inspect content
  const storeList = listPages.flat()
  // list order last-in-first-out
  links.reverse()
  let i = 0
  for (const entry of storeList) {
    t.like(entry, { car: links[i].toString(), size: 5 })
    i++
  }
})

/**
 * @param {import("@aws-sdk/client-dynamodb").DynamoDBClient} dynamoClient
 * @param {import("@aws-sdk/client-s3").S3Client} s3Client
 */
async function prepareResources (dynamoClient, s3Client) {
  const [ tableName, bucketName ] = await Promise.all([
    createDynamoStoreTable(dynamoClient),
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
async function createDynamoStoreTable(dynamo) {
  const id = customAlphabet('1234567890abcdefghijklmnopqrstuvwxyz', 10)
  const tableName = id()

  // TODO: see in pickup Document DB wrapper
  await dynamo.send(new CreateTableCommand({
    TableName: tableName,
    ...dynamoDBTableConfig(storeTableProps),
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
 * @param {`did:key:${string}`} space
 * @param {import('@ucanto/interface').Link<unknown, number, number, 0 | 1>} link
 */
async function getItemFromStoreTable(dynamo, tableName, space, link) {
  const params = {
    TableName: tableName,
    Key: marshall({
      space,
      car: link.toString(),
    })
  }

  const response = await dynamo.send(new GetItemCommand(params))
  return response?.Item && unmarshall(response?.Item)
}
