import { testStore as test } from '../helpers/context.js'
import { CreateTableCommand, GetItemCommand } from '@aws-sdk/client-dynamodb'
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb'
import { PutObjectCommand } from '@aws-sdk/client-s3'

import { parse } from '@ipld/dag-ucan/did'
import { CAR, CBOR } from '@ucanto/transport'

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
        nb: { link },
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
  t.truthy(item.uploadedAt)
  t.truthy(item.proof)
  t.truthy(item.uploaderDID)
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
        nb: { link },
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
  t.truthy(item)
  t.truthy(item.uploadedAt)
  t.truthy(item.proof)
  t.truthy(item.uploaderDID)
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
    AttributesToGet: ['uploaderDID', 'proof', 'uploadedAt'],
  }

  const response = await dynamo.send(new GetItemCommand(params))
  if (!response?.Item) {
    throw new Error('item not found')
  }
  return unmarshall(response?.Item)
}
