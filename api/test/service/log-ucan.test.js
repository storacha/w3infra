import { test } from '../helpers/context.js'
import { createUcanLogger } from '../../service/index.js'
import { ucanLogTableProps } from '../../tables/index.js'

import { customAlphabet } from 'nanoid'
import { CreateTableCommand, GetItemCommand } from '@aws-sdk/client-dynamodb'
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb'

import * as Signer from '@ucanto/principal/ed25519'
import { CAR } from '@ucanto/transport'
import * as UCAN from '@ipld/dag-ucan'

import { createSpace, createTestingUcanLoggerContext } from '../helpers/ucanto.js'
import { createDynamodDb, dynamoDBTableConfig } from '../helpers/resources.js'

test.before(async t => {
  // Dynamo DB
  const {
    client: dynamo,
    endpoint: dbEndpoint
  } = await createDynamodDb({ port: 8000 })

  t.context.dbEndpoint = dbEndpoint
  t.context.dynamoClient = dynamo
})

test('writes invocation to ucan log table', async t => {
  const { tableName } = await prepareResources(t.context.dynamoClient)

  const uploadService = await Signer.generate()
  const alice = await Signer.generate()
  const { proof, spaceDid } = await createSpace(alice)

  const data = new Uint8Array([11, 22, 34, 44, 55])
  const link = await CAR.codec.link(data)
  const nb = { link, size: data.byteLength }
  const can = 'store/add'

  const request = await CAR.encode([
    {
      issuer: alice,
      audience: uploadService,
      capabilities: [{
        can,
        with: spaceDid,
        nb
      }],
      proofs: [proof],
    }
  ])

  const ucanLog = createUcanLogger(createTestingUcanLoggerContext({
    ...t.context,
    tableName
  }))
  // @ts-expect-error different type interface in AWS expected request
  await ucanLog(request)

  const reqCar = await CAR.codec.decode(request.body)
  const reqCarRootCid = reqCar.roots[0].cid
  const item = await getItemFromUcanLogTable(t.context.dynamoClient, tableName, reqCarRootCid)

  t.like(item, {
    root: reqCarRootCid.toString()
  })
  t.true(Date.now() - new Date(item?.insertedAt).getTime() < 60_000)

  // Decode written UCAN
  const itemCar = await CAR.codec.decode(item?.bytes)

  // @ts-expect-error UCAN.View<UCAN.Capabilities> inferred as UCAN.View<unknown>
  const ucan = UCAN.decode(itemCar.roots[0].bytes)

  t.is(ucan.iss.did(), alice.did())
  t.is(ucan.aud.did(), uploadService.did())
  t.deepEqual(ucan.prf, [proof.root.cid])  
  t.is(ucan.att.length, 1)
  t.like(ucan.att[0], {
    nb,
    can,
    with: spaceDid,
  })
})

/**
 * @param {import("@aws-sdk/client-dynamodb").DynamoDBClient} dynamo
 * @param {string} tableName
 * @param {import('../../service/types').AnyLink} root
 */
async function getItemFromUcanLogTable(dynamo, tableName, root) {
  const item = {
    root: root.toString()
  }
  const params = {
    TableName: tableName,
    Key: marshall(item)
  }
  const response = await dynamo.send(new GetItemCommand(params))
  return response?.Item && unmarshall(response?.Item)
}

/**
 * @param {import("@aws-sdk/client-dynamodb").DynamoDBClient} dynamoClient
 */
async function prepareResources (dynamoClient) {
  return {
    tableName: await createDynamoStoreTable(dynamoClient)
  }
}

/**
 * @param {import("@aws-sdk/client-dynamodb").DynamoDBClient} dynamo
 */
async function createDynamoStoreTable(dynamo) {
  const id = customAlphabet('1234567890abcdefghijklmnopqrstuvwxyz', 10)
  const tableName = id()

  await dynamo.send(new CreateTableCommand({
    TableName: tableName,
    ...dynamoDBTableConfig(ucanLogTableProps),
    ProvisionedThroughput: {
      ReadCapacityUnits: 1,
      WriteCapacityUnits: 1
    }
  }))

  return tableName
}