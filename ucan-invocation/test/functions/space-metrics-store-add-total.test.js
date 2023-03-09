import { testConsumer as test } from '../helpers/context.js'

import * as Signer from '@ucanto/principal/ed25519'
import * as StoreCapabilities from '@web3-storage/capabilities/store'

import { spaceMetricsTableProps } from '../../tables/index.js'
import { createDynamodDb } from '../helpers/resources.js'
import { createDynamoTable, getItemFromTable} from '../helpers/tables.js'
import { createSpace } from '../helpers/ucanto.js'
import { randomCAR } from '../helpers/random.js'

import { updateStoreCount } from '../../functions/space-metrics-store-add-total.js'
import { SPACE_METRICS_NAMES } from '../../constants.js'
import { createSpaceMetricsTable } from '../../tables/space-metrics.js'

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

  const spaceMetricsTable = createSpaceMetricsTable(REGION, tableName, {
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
  await updateStoreCount(invocations, {
    spaceMetricsTable
  })

  const item = await getItemFromTable(t.context.dynamoClient, tableName, {
    space: spaceDid,
    name: SPACE_METRICS_NAMES.STORE_ADD_TOTAL
  })
  t.truthy(item)
  t.is(item?.value, 1)
  t.is(item?.space, spaceDid)
})

test('handles batch of single invocation with multiple store/add attributes', async t => {
  const { tableName } = await prepareResources(t.context.dynamoClient)
  const uploadService = await Signer.generate()
  const alice = await Signer.generate()
  const { spaceDid } = await createSpace(alice)

  const cars = await Promise.all(
    Array.from({ length: 10 }).map(() => randomCAR(128))
  )

  const spaceMetricsTable = createSpaceMetricsTable(REGION, tableName, {
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
  await updateStoreCount(invocations, {
    spaceMetricsTable
  })

  const item = await getItemFromTable(t.context.dynamoClient, tableName, {
    space: spaceDid,
    name: SPACE_METRICS_NAMES.STORE_ADD_TOTAL
  })
  t.truthy(item)
  t.is(item?.value, cars.length)
  t.is(item?.space, spaceDid)
})

test('handles batch of multiple invocations with store/add in same space', async t => {
  const { tableName } = await prepareResources(t.context.dynamoClient)
  const uploadService = await Signer.generate()
  const alice = await Signer.generate()
  const { spaceDid } = await createSpace(alice)

  const cars = await Promise.all(
    Array.from({ length: 10 }).map(() => randomCAR(128))
  )

  const spaceMetricsTable = createSpaceMetricsTable(REGION, tableName, {
    endpoint: t.context.dbEndpoint
  })

  const invocations = cars.map((car) => ({
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
  }))

  // @ts-expect-error
  await updateStoreCount(invocations, {
    spaceMetricsTable
  })

  const item = await getItemFromTable(t.context.dynamoClient, tableName, {
    space: spaceDid,
    name: SPACE_METRICS_NAMES.STORE_ADD_TOTAL
  })
  t.truthy(item)
  t.is(item?.value, cars.length)
  t.is(item?.space, spaceDid)
})

test('handles batch of multiple invocations with store/add in multiple spaces', async t => {
  const { tableName } = await prepareResources(t.context.dynamoClient)
  const uploadService = await Signer.generate()
  const alice = await Signer.generate()
  const spaces = await Promise.all(
    Array.from({ length: 10 }).map(() => createSpace(alice))
  )

  const car = await randomCAR(128)
  const spaceMetricsTable = createSpaceMetricsTable(REGION, tableName, {
    endpoint: t.context.dbEndpoint
  })

  const invocations = spaces.map(({ spaceDid }) => ({
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
  }))

  // @ts-expect-error
  await updateStoreCount(invocations, {
    spaceMetricsTable
  })

  const items = await Promise.all(
    spaces.map(({ spaceDid }) => getItemFromTable(t.context.dynamoClient, tableName, {
    space: spaceDid,
    name: SPACE_METRICS_NAMES.STORE_ADD_TOTAL
  }))
  )
  t.truthy(items)
  t.is(items.length, spaces.length)

  for (const item of items) {
    t.is(item?.value, 1)
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
  const spaceMetricsTable = createSpaceMetricsTable(REGION, tableName, {
    endpoint: t.context.dbEndpoint
  })

  const invocations = spaces.map(({ spaceDid }) => ({
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
  }))

  // @ts-expect-error
  await t.throwsAsync(() => updateStoreCount(invocations, {
    spaceMetricsTable
  }))
})

/**
 * @param {import('@aws-sdk/client-dynamodb').DynamoDBClient} dynamoClient
 */
async function prepareResources (dynamoClient) {
  const [ tableName ] = await Promise.all([
    createDynamoTable(dynamoClient, spaceMetricsTableProps),
  ])

  return {
    tableName
  }
}
