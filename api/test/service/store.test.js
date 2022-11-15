import { testStore as test } from '../helpers/context.js'
import { CreateTableCommand, GetItemCommand } from '@aws-sdk/client-dynamodb'
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb'
import { PutObjectCommand } from '@aws-sdk/client-s3'

import { parse } from '@ipld/dag-ucan/did'
import { CAR, CBOR } from '@ucanto/transport'
import { DID } from '@ucanto/core'

import getServiceDid from '../../authority.js'
import { createUcantoServer } from '../../functions/ucan-invocation-router.js'
import { createCarStore } from '../../buckets/car-store.js'
import { createStoreTable } from '../../tables/store.js'
import { createSigner } from '../../signer.js'

import { alice } from '../fixtures.js'
import { createS3, createBucket, createDynamodDb, getSigningOptions } from '../utils.js'

test.beforeEach(async t => {
  const region = 'us-west-2'
  const tableName = 'store'

  // Dynamo DB
  const {
    client: dynamo,
    endpoint: dbEndpoint
  } = await createDynamodDb({ port: 8000, region })
  await createDynamoStoreTable(dynamo)

  // Bucket
  const { client: s3Client, clientOpts: s3ClientOpts } = await createS3({ port: 9000, region })
  const bucketName = await createBucket(s3Client)

  t.context.dbEndpoint = dbEndpoint
  t.context.dynamoClient = dynamo
  t.context.tableName = tableName
  t.context.region = region
  t.context.bucketName = bucketName
  t.context.s3Client = s3Client
  t.context.s3ClientOpts = s3ClientOpts
  t.context.serviceDid = await getServiceDid()
})

test('store add returns signed url for uploading', async (t) => {
  const server = await createStoreUcantoServer(t.context)
  const account = alice.did()
  const link = await CAR.codec.link(
    new Uint8Array([11, 22, 34, 44, 55])
  )

  const request = await CAR.encode([
    {
      issuer: alice,
      audience: parse(t.context.serviceDid.did()),
      capabilities: [{
        can: 'store/add',
        with: account,
        nb: { link, size: 5 },
      }],
      proofs: [],
    }
  ])

  const storeAddResponse = await server.request(request)
  /** @type {import('../../service/types').StoreAddSuccessResult[]} */
  // @ts-expect-error
  const storeAdd = await CBOR.decode(storeAddResponse)
  t.is(storeAdd.length, 1)
  t.is(storeAdd[0].status, 'upload')
  t.is(storeAdd[0].with, account)
  t.deepEqual(storeAdd[0].link, link)
  t.truthy(storeAdd[0].url)

  const item = await getItemFromStoreTable(t.context.dynamoClient, alice, link)
  t.truthy(item)
  t.is(typeof item?.uploadedAt, 'string')
  t.is(typeof item?.proof, 'string')
  t.is(typeof item?.uploaderDID, 'string')
  t.truthy(DID.parse(item?.uploaderDID))
  t.is(typeof item?.size, 'number')
})

test('store add returns done if already uploaded', async (t) => {
  const server = await createStoreUcantoServer(t.context)
  const account = alice.did()
  const data = new Uint8Array([11, 22, 34, 44, 55])
  const link = await CAR.codec.link(data)

  await t.context.s3Client.send(
    new PutObjectCommand({
      Bucket: t.context.bucketName,
      Key: `${link}/${link}.car`,
      Body: data,
    })
  )

  const request = await CAR.encode([
    {
      issuer: alice,
      audience: parse(t.context.serviceDid.did()),
      capabilities: [{
        can: 'store/add',
        with: account,
        nb: { link, size: 5 },
      }],
      proofs: [],
    }
  ])

  const storeAddResponse = await server.request(request)
  /** @type {import('../../service/types').StoreAddSuccessResult[]} */
  // @ts-expect-error
  const storeAdd = await CBOR.decode(storeAddResponse)

  t.is(storeAdd.length, 1)
  t.is(storeAdd[0].status, 'done')
  t.is(storeAdd[0].with, account)
  t.deepEqual(storeAdd[0].link, link)
  t.falsy(storeAdd[0].url)

  // Even if done (CAR already exists in bucket), mapped to user if non existing
  const item = await getItemFromStoreTable(t.context.dynamoClient, alice, link)
  t.is(typeof item?.uploadedAt, 'string')
  t.is(typeof item?.proof, 'string')
  t.is(typeof item?.uploaderDID, 'string')
  t.truthy(DID.parse(item?.uploaderDID))
  t.is(typeof item?.size, 'number')
})

test('store remove does not fail for non existent link', async (t) => {
  const server = await createStoreUcantoServer(t.context)
  const account = alice.did()
  const data = new Uint8Array([11, 22, 34, 44, 55])
  const link = await CAR.codec.link(data)

  const request = await CAR.encode([
    {
      issuer: alice,
      audience: parse(t.context.serviceDid.did()),
      capabilities: [{
        can: 'store/remove',
        with: account,
        nb: { link },
      }],
      proofs: [],
    }
  ])

  const storeRemoveResponse = await server.request(request)
  const storeRemove = await CBOR.decode(storeRemoveResponse)
  t.is(storeRemove.length, 1)
})

test('store remove invocation removes car bound to issuer from store table', async (t) => {
  const server = await createStoreUcantoServer(t.context)
  const account = alice.did()
  const link = await CAR.codec.link(
    new Uint8Array([11, 22, 34, 44, 55])
  )

  // Validate Store Table content does not exist before add
  const dynamoItemBeforeAdd = await getItemFromStoreTable(t.context.dynamoClient, alice, link)
  t.falsy(dynamoItemBeforeAdd)

  const addRequest = await CAR.encode([
    {
      issuer: alice,
      audience: parse(t.context.serviceDid.did()),
      capabilities: [{
        can: 'store/add',
        with: account,
        nb: { link, size: 5 },
      }],
      proofs: [],
    }
  ])
  await server.request(addRequest)

  // Validate Store Table content exists after add
  const dynamoItemAfterAdd = await getItemFromStoreTable(t.context.dynamoClient, alice, link)
  t.truthy(dynamoItemAfterAdd)

  const removeRequest = await CAR.encode([
    {
      issuer: alice,
      audience: parse(t.context.serviceDid.did()),
      capabilities: [{
        can: 'store/remove',
        with: account,
        nb: { link },
      }],
      proofs: [],
    }
  ])
  const storeRemoveResponse = await server.request(removeRequest)
  const storeRemove = await CBOR.decode(storeRemoveResponse)
  t.is(storeRemove.length, 1)

  // Validate Store Table content does not exist after remove
  const dynamoItemAfterRemove = await getItemFromStoreTable(t.context.dynamoClient, alice, link)
  t.falsy(dynamoItemAfterRemove)
})

test('store list does not fail for empty list', async (t) => {
  const server = await createStoreUcantoServer(t.context)
  const account = alice.did()

  const request = await CAR.encode([
    {
      issuer: alice,
      audience: parse(t.context.serviceDid.did()),
      capabilities: [{
        can: 'store/list',
        with: account,
      }],
      proofs: [],
    }
  ])

  const storeListResponse = await server.request(request)
  /** @type {import('../../service/types').ListResponse<any>[]} */
  // @ts-expect-error
  const storeList = await CBOR.decode(storeListResponse)
  t.is(storeList.length, 1)
  t.is(storeList[0].results.length, 0)
  t.is(storeList[0].pageSize, 0)
})

test('store list returns items previously stored by the user', async (t) => {
  const server = await createStoreUcantoServer(t.context)
  const account = alice.did()

  // Request to store a few links
  const links = await Promise.all([
    new Uint8Array([11, 22, 34, 44, 55]),
    new Uint8Array([22, 34, 44, 55, 66])
  ].map(async (data) => {
    const link = await CAR.codec.link(data)
    const request = await CAR.encode([
      {
        issuer: alice,
        audience: parse(t.context.serviceDid.did()),
        capabilities: [{
          can: 'store/add',
          with: account,
          nb: { link, size: 5 },
        }],
        proofs: [],
      }
    ])
    await server.request(request)

    return link
  }))

  const request = await CAR.encode([
    {
      issuer: alice,
      audience: parse(t.context.serviceDid.did()),
      capabilities: [{
        can: 'store/list',
        with: account,
      }],
      proofs: [],
    }
  ])

  const storeListResponse = await server.request(request)
  /** @type {import('../../service/types').ListResponse<import('../../service/types').StoreListResult>[]} */
  // @ts-expect-error
  const storeList = await CBOR.decode(storeListResponse)
  t.is(storeList.length, 1)
  t.is(storeList[0].results.length, 2)
  t.is(storeList[0].pageSize, 2)

  // Has stored links
  for (const link of links) {
    t.truthy(storeList[0].results.find(i => i.payloadCID === link.toString()))
  }
})

/**
 * @param {any} ctx
 */
function createStoreUcantoServer(ctx) {
  return createUcantoServer({
    storeTable: createStoreTable(ctx.region, ctx.tableName, {
      endpoint: ctx.dbEndpoint
    }),
    carStoreBucket: createCarStore(ctx.region, ctx.bucketName, { ...ctx.s3ClientOpts }),
    signer: createSigner(getSigningOptions(ctx))
  })
}

/**
 * @param {import("@aws-sdk/client-dynamodb").DynamoDBClient} dynamo
 */
async function createDynamoStoreTable(dynamo) {
  // TODO: see in pickup Document DB wrapper
  await dynamo.send(new CreateTableCommand({
    TableName: 'store',
    AttributeDefinitions: [
      { AttributeName: 'uploaderDID', AttributeType: 'S' },
      { AttributeName: 'payloadCID', AttributeType: 'S' }
    ],
    KeySchema: [
      { AttributeName: 'uploaderDID', KeyType: 'HASH' },
      { AttributeName: 'payloadCID', KeyType: 'RANGE' },
    ],
    ProvisionedThroughput: {
      ReadCapacityUnits: 1,
      WriteCapacityUnits: 1
    }
  }))
}

/**
 * @param {import("@aws-sdk/client-dynamodb").DynamoDBClient} dynamo
 * @param {import('@ucanto/principal/ed25519').EdSigner} did
 * @param {import('@ucanto/interface').Link<unknown, number, number, 0 | 1>} link
 */
async function getItemFromStoreTable(dynamo, did, link) {
  const params = {
    TableName: 'store',
    Key: marshall({
      uploaderDID: did.did(),
      payloadCID: link.toString(),
    }),
    AttributesToGet: ['uploaderDID', 'proof', 'uploadedAt', 'size'],
  }

  const response = await dynamo.send(new GetItemCommand(params))
  return response?.Item && unmarshall(response?.Item)
}
