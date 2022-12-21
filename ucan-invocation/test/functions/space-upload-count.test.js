import { testConsumer as test } from '../helpers/context.js'

import { customAlphabet } from 'nanoid'
import { CreateTableCommand, GetItemCommand } from '@aws-sdk/client-dynamodb'
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb'
import * as Signer from '@ucanto/principal/ed25519'
import * as UploadCapabilities from '@web3-storage/capabilities/upload'

import { spaceUploadCountTableProps } from '../../tables/index.js'
import { createDynamodDb, dynamoDBTableConfig } from '../helpers/resources.js'
import { createSpace } from '../helpers/ucanto.js'
import { randomCAR } from '../helpers/random.js'

import { updateUploadCount } from '../../functions/space-upload-count.js'
import { createUploadCountTable } from '../../tables/space-upload-count.js'

const REGION = 'us-west-2'

test.before(async t => {
  // Dynamo DB
  const {
    client: dynamo,
    endpoint: dbEndpoint
  } = await createDynamodDb({ port: 8000 })

  t.context.dbEndpoint = dbEndpoint
  t.context.dynamoClient = dynamo
})

test('handles a batch of single invocation with upload/add', async t => {
  const { tableName } = await prepareResources(t.context.dynamoClient)
  const uploadService = await Signer.generate()
  const alice = await Signer.generate()
  const { spaceDid } = await createSpace(alice)
  const car = await randomCAR(128)

  const uploadCountTable = createUploadCountTable(REGION, tableName, {
    endpoint: t.context.dbEndpoint
  })

  const invocations = [{
    carCid: car.cid.toString(),
    value: {
        att: [
          UploadCapabilities.add.create({
            with: spaceDid,
            nb: {
              root: car.cid,
              shards: [car.cid]
            }
          })
        ],
        aud: uploadService.did(),
        iss: alice.did()
    },
    ts: Date.now()
  }]

  // @ts-expect-error
  await updateUploadCount(invocations, {
    uploadCountTable
  })

  const item = await getItemFromTable(t.context.dynamoClient, tableName, spaceDid)
  t.truthy(item)
  t.is(item?.count, 1)
  t.is(item?.space, spaceDid)
})

test('handles batch of single invocation with multiple upload/add attributes', async t => {
  const { tableName } = await prepareResources(t.context.dynamoClient)
  const uploadService = await Signer.generate()
  const alice = await Signer.generate()
  const { spaceDid } = await createSpace(alice)

  const cars = await Promise.all(
    Array.from({ length: 10 }).map(() => randomCAR(128))
  )

  const uploadCountTable = createUploadCountTable(REGION, tableName, {
    endpoint: t.context.dbEndpoint
  })

  const invocations = [{
    carCid: cars[0].cid.toString(),
    value: {
      att: cars.map((car) => UploadCapabilities.add.create({
        with: spaceDid,
        nb: {
          root: car.cid,
          shards: [car.cid]
        }
      })),
      aud: uploadService.did(),
      iss: alice.did()
    },
    ts: Date.now()
  }]

  // @ts-expect-error
  await updateUploadCount(invocations, {
    uploadCountTable
  })

  const item = await getItemFromTable(t.context.dynamoClient, tableName, spaceDid)
  t.truthy(item)
  t.is(item?.count, cars.length)
  t.is(item?.space, spaceDid)
})

test('handles batch of multiple invocations with upload/add in same space', async t => {
  const { tableName } = await prepareResources(t.context.dynamoClient)
  const uploadService = await Signer.generate()
  const alice = await Signer.generate()
  const { spaceDid } = await createSpace(alice)

  const cars = await Promise.all(
    Array.from({ length: 10 }).map(() => randomCAR(128))
  )

  const uploadCountTable = createUploadCountTable(REGION, tableName, {
    endpoint: t.context.dbEndpoint
  })

  const invocations = cars.map((car) => ({
    carCid: car.cid.toString(),
    value: {
        att: [
          UploadCapabilities.add.create({
            with: spaceDid,
            nb: {
              root: car.cid,
              shards: [car.cid]
            }
          })
        ],
        aud: uploadService.did(),
        iss: alice.did()
    },
    ts: Date.now()
  }))

  // @ts-expect-error
  await updateUploadCount(invocations, {
    uploadCountTable
  })

  const item = await getItemFromTable(t.context.dynamoClient, tableName, spaceDid)
  t.truthy(item)
  t.is(item?.count, cars.length)
  t.is(item?.space, spaceDid)
})

test('handles batch of multiple invocations with upload/add in multiple spaces', async t => {
  const { tableName } = await prepareResources(t.context.dynamoClient)
  const uploadService = await Signer.generate()
  const alice = await Signer.generate()
  const spaces = await Promise.all(
    Array.from({ length: 10 }).map(() => createSpace(alice))
  )

  const car = await randomCAR(128)
  const uploadCountTable = createUploadCountTable(REGION, tableName, {
    endpoint: t.context.dbEndpoint
  })

  const invocations = spaces.map(({ spaceDid }) => ({
    carCid: car.cid.toString(),
    value: {
        att: [
          UploadCapabilities.add.create({
            with: spaceDid,
            nb: {
              root: car.cid,
              shards: [car.cid]
            }
          })
        ],
        aud: uploadService.did(),
        iss: alice.did()
    },
    ts: Date.now()
  }))

  // @ts-expect-error
  await updateUploadCount(invocations, {
    uploadCountTable
  })

  const items = await Promise.all(
    spaces.map(({ spaceDid }) => getItemFromTable(t.context.dynamoClient, tableName, spaceDid))
  )
  t.truthy(items)
  t.is(items.length, spaces.length)

  for (const item of items) {
    t.is(item?.count, 1)
  }
})

test('errors handling batch of multiple invocations with more transactions than allowed', async t => {
  const { tableName } = await prepareResources(t.context.dynamoClient)
  const uploadService = await Signer.generate()
  const alice = await Signer.generate()
  const spaces = await Promise.all(
    Array.from({ length: 105 }).map(() => createSpace(alice))
  )

  const car = await randomCAR(128)
  const uploadCountTable = createUploadCountTable(REGION, tableName, {
    endpoint: t.context.dbEndpoint
  })

  const invocations = spaces.map(({ spaceDid }) => ({
    carCid: car.cid.toString(),
    value: {
        att: [
          UploadCapabilities.add.create({
            with: spaceDid,
            nb: {
              root: car.cid,
              shards: [car.cid]
            }
          })
        ],
        aud: uploadService.did(),
        iss: alice.did()
    },
    ts: Date.now()
  }))

  // @ts-expect-error
  await t.throwsAsync(() => updateUploadCount(invocations, {
    uploadCountTable
  }))
})

/**
 * @param {import('@aws-sdk/client-dynamodb').DynamoDBClient} dynamoClient
 */
async function prepareResources (dynamoClient) {
  const [ tableName ] = await Promise.all([
    createDynamouploadTable(dynamoClient),
  ])

  return {
    tableName
  }
}

/**
 * @param {import('@aws-sdk/client-dynamodb').DynamoDBClient} dynamo
 */
async function createDynamouploadTable(dynamo) {
  const id = customAlphabet('1234567890abcdefghijklmnopqrstuvwxyz', 10)
  const tableName = id()

  await dynamo.send(new CreateTableCommand({
    TableName: tableName,
    ...dynamoDBTableConfig(spaceUploadCountTableProps),
    ProvisionedThroughput: {
      ReadCapacityUnits: 1,
      WriteCapacityUnits: 1
    }
  }))

  return tableName
}

/**
 * @param {import('@aws-sdk/client-dynamodb').DynamoDBClient} dynamo
 * @param {string} tableName
 * @param {`did:key:${string}`} space
 */
async function getItemFromTable(dynamo, tableName, space) {
  const params = {
    TableName: tableName,
    Key: marshall({
      space,
    })
  }
  const response = await dynamo.send(new GetItemCommand(params))
  return response?.Item && unmarshall(response?.Item)
}
