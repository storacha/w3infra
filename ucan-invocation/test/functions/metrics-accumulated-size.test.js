import { testConsumer as test } from '../helpers/context.js'

import { customAlphabet } from 'nanoid'
import { CreateTableCommand, GetItemCommand } from '@aws-sdk/client-dynamodb'
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb'
import * as Signer from '@ucanto/principal/ed25519'
import * as StoreCapabilities from '@web3-storage/capabilities/store'

import { w3MetricsTableProps } from '../../tables/index.js'
import { createDynamodDb, dynamoDBTableConfig } from '../helpers/resources.js'
import { createSpace } from '../helpers/ucanto.js'
import { randomCAR } from '../helpers/random.js'

import { updateAccumulatedSize } from '../../functions/metrics-accumulated-size.js'
import { createW3MetricsTable } from '../../tables/w3-metrics.js'
import { W3_METRICS_NAMES } from '../../constants.js'

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

test('handles a batch of single invocation with store/add', async t => {
  const { tableName } = await prepareResources(t.context.dynamoClient)
  const uploadService = await Signer.generate()
  const alice = await Signer.generate()
  const { spaceDid } = await createSpace(alice)
  const car = await randomCAR(128)

  const w3MetricsTable = createW3MetricsTable(REGION, tableName, {
    endpoint: t.context.dbEndpoint
  })

  const invocations = [{
    carCid: car.cid.toString(),
    value: {
        att: [
          StoreCapabilities.add.create({
            with: spaceDid,
            nb: {
              link: car.cid,
              size: car.size
            }
          })
        ],
        aud: uploadService.did(),
        iss: alice.did()
    },
    ts: Date.now()
  }]

  // @ts-expect-error
  await updateAccumulatedSize(invocations, {
    w3MetricsTable
  })

  const item = await getItemFromTable(t.context.dynamoClient, tableName, W3_METRICS_NAMES.STORE_ADD_ACCUM_SIZE)
  t.truthy(item)
  t.is(item?.name, W3_METRICS_NAMES.STORE_ADD_ACCUM_SIZE)
  t.is(item?.value, car.size)
})

test('handles batch of single invocations with multiple store/add attributes', async t => {
  const { tableName } = await prepareResources(t.context.dynamoClient)
  const uploadService = await Signer.generate()
  const alice = await Signer.generate()
  const { spaceDid } = await createSpace(alice)

  const cars = await Promise.all(
    Array.from({ length: 10 }).map(() => randomCAR(128))
  )

  const w3MetricsTable = createW3MetricsTable(REGION, tableName, {
    endpoint: t.context.dbEndpoint
  })

  const invocations = [{
    carCid: cars[0].cid.toString(),
    value: {
      att: cars.map((car) => StoreCapabilities.add.create({
        with: spaceDid,
        nb: {
          link: car.cid,
          size: car.size
        }
      })),
      aud: uploadService.did(),
      iss: alice.did()
    },
    ts: Date.now()
  }]

  // @ts-expect-error
  await updateAccumulatedSize(invocations, {
    w3MetricsTable
  })

  const item = await getItemFromTable(t.context.dynamoClient, tableName, W3_METRICS_NAMES.STORE_ADD_ACCUM_SIZE)
  t.truthy(item)
  t.is(item?.name, W3_METRICS_NAMES.STORE_ADD_ACCUM_SIZE)
  t.is(item?.value, cars.reduce((acc, c) => acc + c.size, 0))
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
    ...dynamoDBTableConfig(w3MetricsTableProps),
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
 * @param {string} name
 */
async function getItemFromTable(dynamo, tableName, name) {
  const params = {
    TableName: tableName,
    Key: marshall({
      name,
    })
  }
  const response = await dynamo.send(new GetItemCommand(params))
  return response?.Item && unmarshall(response?.Item)
}