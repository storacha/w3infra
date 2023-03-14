import { testConsumer as test } from '../helpers/context.js'

import * as Signer from '@ucanto/principal/ed25519'
import * as UploadCapabilities from '@web3-storage/capabilities/upload'

import { createDynamodDb } from '../helpers/resources.js'
import { createSpace } from '../helpers/ucanto.js'
import { randomCAR } from '../helpers/random.js'
import { createDynamoAdminMetricsTable, getItemFromTable} from '../helpers/tables.js'

import { updateUploadRemoveTotal } from '../../functions/metrics-upload-remove-total.js'
import { createMetricsTable } from '../../tables/metrics.js'
import { METRICS_NAMES } from '../../constants.js'

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

test('handles a batch of single invocation with upload/remove', async t => {
  const { tableName } = await prepareResources(t.context.dynamoClient)
  const uploadService = await Signer.generate()
  const alice = await Signer.generate()
  const { spaceDid } = await createSpace(alice)
  const car = await randomCAR(128)

  const metricsTable = createMetricsTable(REGION, tableName, {
    endpoint: t.context.dbEndpoint
  })

  const invocations = [{
    carCid: car.cid.toString(),
    value: {
        att: [
          UploadCapabilities.remove.create({
            with: spaceDid,
            nb: {
              root: car.cid
            }
          })
        ],
        aud: uploadService.did(),
        iss: alice.did()
    },
    ts: Date.now()
  }]

  // @ts-expect-error
  await updateUploadRemoveTotal(invocations, {
    metricsTable
  })

  const item = await getItemFromTable(t.context.dynamoClient, tableName, {
    name: METRICS_NAMES.UPLOAD_REMOVE_TOTAL
  })
  t.truthy(item)
  t.is(item?.name, METRICS_NAMES.UPLOAD_REMOVE_TOTAL)
  t.is(item?.value, 1)
})

test('handles batch of single invocations with multiple upload/remove attributes', async t => {
  const { tableName } = await prepareResources(t.context.dynamoClient)
  const uploadService = await Signer.generate()
  const alice = await Signer.generate()
  const { spaceDid } = await createSpace(alice)

  const cars = await Promise.all(
    Array.from({ length: 10 }).map(() => randomCAR(128))
  )

  const metricsTable = createMetricsTable(REGION, tableName, {
    endpoint: t.context.dbEndpoint
  })

  const invocations = [{
    carCid: cars[0].cid.toString(),
    value: {
      att: cars.map((car) => UploadCapabilities.remove.create({
        with: spaceDid,
        nb: {
          root: car.cid
        }
      })),
      aud: uploadService.did(),
      iss: alice.did()
    },
    ts: Date.now()
  }]

  // @ts-expect-error
  await updateUploadRemoveTotal(invocations, {
    metricsTable
  })

  const item = await getItemFromTable(t.context.dynamoClient, tableName, {
    name: METRICS_NAMES.UPLOAD_REMOVE_TOTAL
  })

  t.truthy(item)
  t.is(item?.name, METRICS_NAMES.UPLOAD_REMOVE_TOTAL)
  t.is(item?.value, cars.length)
})

test('handles a batch of single invocation without upload/remove', async t => {
  const { tableName } = await prepareResources(t.context.dynamoClient)
  const uploadService = await Signer.generate()
  const alice = await Signer.generate()
  const { spaceDid } = await createSpace(alice)
  const car = await randomCAR(128)

  const metricsTable = createMetricsTable(REGION, tableName, {
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
  await updateUploadRemoveTotal(invocations, {
    metricsTable
  })

  const item = await getItemFromTable(t.context.dynamoClient, tableName, {
    name: METRICS_NAMES.UPLOAD_REMOVE_TOTAL
  })

  t.truthy(item)
  t.is(item?.name, METRICS_NAMES.UPLOAD_REMOVE_TOTAL)
  t.is(item?.value, 0)
})

/**
 * @param {import('@aws-sdk/client-dynamodb').DynamoDBClient} dynamoClient
 */
async function prepareResources (dynamoClient) {
  const [ tableName ] = await Promise.all([
    createDynamoAdminMetricsTable(dynamoClient),
  ])

  return {
    tableName
  }
}
