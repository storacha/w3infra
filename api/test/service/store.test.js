import { testStore as test } from '../helpers/context.js'
import { CreateTableCommand, GetItemCommand } from '@aws-sdk/client-dynamodb'
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb'
import { PutObjectCommand } from '@aws-sdk/client-s3'
import * as Signer from '@ucanto/principal/ed25519'
import { CAR } from '@ucanto/transport'
import * as StoreCapabilities from '@web3-storage/access/capabilities/store'
import { base64pad } from 'multiformats/bases/base64'
import getServiceDid from '../../authority.js'
import { getClientConnection, createSpace } from '../helpers/ucanto.js'
import { createS3, createBucket, createDynamodDb } from '../utils.js'

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

test('store/add returns signed url for uploading', async (t) => {
  const uploadService = t.context.serviceDid
  const alice = await Signer.generate()
  const { proof, spaceDid } = await createSpace(alice)
  const connection = await getClientConnection(uploadService, t.context)

  const data = new Uint8Array([11, 22, 34, 44, 55])
  const link = await CAR.codec.link(data)

  // invoke a store/add with proof
  const storeAdd = await StoreCapabilities.add.invoke({
    issuer: alice,
    audience: uploadService,
    with: spaceDid,
    nb: { link, size: data.byteLength },
    proofs: [proof]
    // @ts-expect-error ʅʕ•ᴥ•ʔʃ
  }).execute(connection)

  t.not(storeAdd.error, true, storeAdd.message)
  t.is(storeAdd.status, 'upload')
  t.is(storeAdd.with, spaceDid)
  t.deepEqual(storeAdd.link, link)
  t.is(new URL(storeAdd.url).pathname, `/${link}/${link}.car`)
  t.is(storeAdd.headers['x-amz-checksum-sha256'], base64pad.baseEncode(link.multihash.digest))

  const item = await getItemFromStoreTable(t.context.dynamoClient, spaceDid, link)
  t.truthy(item)
  t.is(typeof item?.uploadedAt, 'string')
  t.is(typeof item?.proof, 'string')
  t.is(typeof item?.uploaderDID, 'string')
  // TODO: this looks suspicious... why is uploaderDID not the issuer / alice who invoked the upload
  t.is(item?.uploaderDID, spaceDid)
  t.is(typeof item?.size, 'number')
  t.is(item?.size, data.byteLength)
})

test('store/add returns done if already uploaded', async (t) => {
  const uploadService = t.context.serviceDid
  const alice = await Signer.generate()
  const { proof, spaceDid } = await createSpace(alice)
  const connection = await getClientConnection(uploadService, t.context)

  const data = new Uint8Array([11, 22, 34, 44, 55])
  const link = await CAR.codec.link(data)

  // simulate an already stored CAR
  await t.context.s3Client.send(
    new PutObjectCommand({
      Bucket: t.context.bucketName,
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
    // @ts-expect-error ʅʕ•ᴥ•ʔʃ
  }).execute(connection)

  t.is(storeAdd.status, 'done')
  t.is(storeAdd.with, spaceDid)
  t.deepEqual(storeAdd.link, link)
  t.falsy(storeAdd.url)

  // Even if done (CAR already exists in bucket), mapped to user if non existing
  const item = await getItemFromStoreTable(t.context.dynamoClient, spaceDid, link)
  t.is(typeof item?.uploadedAt, 'string')
  t.is(typeof item?.proof, 'string')
  t.is(typeof item?.uploaderDID, 'string')
  t.is(item?.uploaderDID, spaceDid)
  t.is(typeof item?.size, 'number')
  t.is(item?.size, data.byteLength)
})

test('store/remove does not fail for non existent link', async (t) => {
  const uploadService = t.context.serviceDid
  const alice = await Signer.generate()
  const { proof, spaceDid } = await createSpace(alice)
  const connection = await getClientConnection(uploadService, t.context)

  const data = new Uint8Array([11, 22, 34, 44, 55])
  const link = await CAR.codec.link(data)

  const storeRemove = await StoreCapabilities.remove.invoke({
    issuer: alice,
    audience: uploadService,
    with: spaceDid,
    nb: { link },
    proofs: [proof]
    // @ts-expect-error ʅʕ•ᴥ•ʔʃ
  }).execute(connection)

  // expect no response for a remove
  t.falsy(storeRemove)

  const storeRemove2 = await StoreCapabilities.remove.invoke({
    issuer: alice,
    audience: uploadService,
    with: spaceDid,
    nb: { link },
    proofs: [proof]
    // @ts-expect-error ʅʕ•ᴥ•ʔʃ
  }).execute(connection)

  // expect no response for a remove
  t.falsy(storeRemove2)
})

test('store/remove removes car bound to issuer from store table', async (t) => {
  const uploadService = t.context.serviceDid
  const alice = await Signer.generate()
  const { proof, spaceDid } = await createSpace(alice)
  const connection = await getClientConnection(uploadService, t.context)

  const data = new Uint8Array([11, 22, 34, 44, 55])
  const link = await CAR.codec.link(data)

  // Validate Store Table content does not exist before add
  const dynamoItemBeforeAdd = await getItemFromStoreTable(t.context.dynamoClient, spaceDid, link)
  t.falsy(dynamoItemBeforeAdd)

  const storeAdd = await StoreCapabilities.add.invoke({
    issuer: alice,
    audience: uploadService,
    with: spaceDid,
    nb: { link, size: data.byteLength },
    proofs: [proof]
    // @ts-expect-error ʅʕ•ᴥ•ʔʃ
  }).execute(connection)

  t.is(storeAdd.status, 'upload')

  // Validate Store Table content exists after add
  const dynamoItemAfterAdd = await getItemFromStoreTable(t.context.dynamoClient, spaceDid, link)
  t.truthy(dynamoItemAfterAdd)

  const storeRemove = await StoreCapabilities.remove.invoke({
    issuer: alice,
    audience: uploadService,
    with: spaceDid,
    nb: { link },
    proofs: [proof]
    // @ts-expect-error ʅʕ•ᴥ•ʔʃ
  }).execute(connection)

  t.falsy(storeRemove)

  // Validate Store Table content does not exist after remove
  const dynamoItemAfterRemove = await getItemFromStoreTable(t.context.dynamoClient, spaceDid, link)
  t.falsy(dynamoItemAfterRemove)
})

test('store/list does not fail for empty list', async (t) => {
  const uploadService = t.context.serviceDid
  const alice = await Signer.generate()
  const { proof, spaceDid } = await createSpace(alice)
  const connection = await getClientConnection(uploadService, t.context)
  
  const storeList = await StoreCapabilities.list.invoke({
    issuer: alice,
    audience: uploadService,
    with: spaceDid,
    proofs: [ proof ]
    // @ts-expect-error ʅʕ•ᴥ•ʔʃ
  }).execute(connection)

  t.like(storeList, { results: [], pageSize: 0 })
})

test('store/list returns items previously stored by the user', async (t) => {
  const uploadService = t.context.serviceDid
  const alice = await Signer.generate()
  const { proof, spaceDid } = await createSpace(alice)
  const connection = await getClientConnection(uploadService, t.context)

  const data = [ new Uint8Array([11, 22, 34, 44, 55]), new Uint8Array([22, 34, 44, 55, 66]) ]
  const links = []
  for (const datum of data) {
    const storeAdd = await StoreCapabilities.add.invoke({
      issuer: alice,
      audience: uploadService,
      with: spaceDid,
      nb: { link: await CAR.codec.link(datum) , size: datum.byteLength },
      proofs: [proof]
      // @ts-expect-error ʅʕ•ᴥ•ʔʃ
    }).execute(connection)
    t.not(storeAdd.error, true, storeAdd.message)
    t.is(storeAdd.status, 'upload')
    links.push(storeAdd.link)
  }

  const storeList = await StoreCapabilities.list.invoke({
    issuer: alice,
    audience: uploadService,
    with: spaceDid,
    proofs: [ proof ]
    // @ts-expect-error ʅʕ•ᴥ•ʔʃ
  }).execute(connection)

  t.is(storeList.pageSize, links.length)

  // list order last-in-first-out
  links.reverse()
  let i = 0
  for (const entry of storeList.results) {
    t.like(entry, { payloadCID: links[i].toString(), size: 5 })
    i++
  }
})

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
 * @param {`did:key:${string}`} spaceDid
 * @param {import('@ucanto/interface').Link<unknown, number, number, 0 | 1>} link
 */
async function getItemFromStoreTable(dynamo, spaceDid, link) {
  const params = {
    TableName: 'store',
    Key: marshall({
      uploaderDID: spaceDid,
      payloadCID: link.toString(),
    }),
    AttributesToGet: ['uploaderDID', 'proof', 'uploadedAt', 'size'],
  }

  const response = await dynamo.send(new GetItemCommand(params))
  return response?.Item && unmarshall(response?.Item)
}
