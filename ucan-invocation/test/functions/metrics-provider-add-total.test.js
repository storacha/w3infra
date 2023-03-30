import { testConsumer as test } from '../helpers/context.js'

import * as Signer from '@ucanto/principal/ed25519'
import * as ProviderCapabilities from '@web3-storage/capabilities/provider'
import * as UploadCapabilities from '@web3-storage/capabilities/upload'

import { createDynamodDb } from '../helpers/resources.js'
import { createAccount, createSpace } from '../helpers/ucanto.js'
import { randomCAR } from '../helpers/random.js'
import { createDynamoTable, getItemFromTable} from '../helpers/tables.js'
import { adminMetricsTableProps } from '../../tables/index.js'

import { updateProviderAddTotal } from '../../functions/metrics-provider-add-total.js'
import { createMetricsTable } from '../../tables/metrics.js'
import { METRICS_NAMES, STREAM_TYPE } from '../../constants.js'

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

test('handles a batch of single invocation with provider/add', async t => {
  const { tableName } = await prepareResources(t.context.dynamoClient)
  const uploadService = await Signer.generate()
  const alice = await Signer.generate()
  const { spaceDid } = await createSpace(alice)
  const account = createAccount()
  const car = await randomCAR(128)

  const metricsTable = createMetricsTable(REGION, tableName, {
    endpoint: t.context.dbEndpoint
  })

  const invocations = [{
    carCid: car.cid.toString(),
    value: {
        att: [
          ProviderCapabilities.add.create({
            with: account.did(),
            nb: {
              provider: 'did:web:web3.storage"',
              consumer: spaceDid,
            }
          })
        ],
        aud: uploadService.did(),
        iss: alice.did()
    },
    type: STREAM_TYPE.RECEIPT,
    out: {
      ok: true
    },
    ts: Date.now()
  }]

  // @ts-expect-error
  await updateProviderAddTotal(invocations, {
    metricsTable
  })

  const item = await getItemFromTable(t.context.dynamoClient, tableName, {
    name: METRICS_NAMES.PROVIDER_ADD_TOTAL
  })
  t.truthy(item)
  t.is(item?.name, METRICS_NAMES.PROVIDER_ADD_TOTAL)
  t.is(item?.value, 1)
})

test('handles batch of single invocations with multiple provider/add attributes', async t => {
  const { tableName } = await prepareResources(t.context.dynamoClient)
  const uploadService = await Signer.generate()
  const alice = await Signer.generate()
  const { spaceDid } = await createSpace(alice)
  const account = createAccount()
  const car = await randomCAR(128)
  const length = 10

  const metricsTable = createMetricsTable(REGION, tableName, {
    endpoint: t.context.dbEndpoint
  })

  const invocations = [{
    carCid: car.cid.toString(),
    value: {
      att: Array.from({ length }).map(() => ProviderCapabilities.add.create({
        with: account.did(),
        nb: {
          provider: 'did:web:web3.storage"',
          consumer: spaceDid,
        }
      })),
      aud: uploadService.did(),
      iss: alice.did()
    },
    type: STREAM_TYPE.RECEIPT,
    out: {
      ok: true
    },
    ts: Date.now()
  }]

  // @ts-expect-error
  await updateProviderAddTotal(invocations, {
    metricsTable
  })

  const item = await getItemFromTable(t.context.dynamoClient, tableName, {
    name: METRICS_NAMES.PROVIDER_ADD_TOTAL
  })

  t.truthy(item)
  t.is(item?.name, METRICS_NAMES.PROVIDER_ADD_TOTAL)
  t.is(item?.value, length)
})

test('handles a batch of single invocation without provider/add', async t => {
  const { tableName } = await prepareResources(t.context.dynamoClient)
  const uploadService = await Signer.generate()
  const alice = await Signer.generate()
  const { spaceDid } = await createSpace(alice)
  const account = createAccount()
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
              root: car.cid,
            }
          })
        ],
        aud: uploadService.did(),
        iss: alice.did()
    },
    type: STREAM_TYPE.RECEIPT,
    out: {
      ok: true
    },
    ts: Date.now()
  }]

  // @ts-expect-error
  await updateProviderAddTotal(invocations, {
    metricsTable
  })

  const item = await getItemFromTable(t.context.dynamoClient, tableName, {
    name: METRICS_NAMES.PROVIDER_ADD_TOTAL
  })

  t.truthy(item)
  t.is(item?.name, METRICS_NAMES.PROVIDER_ADD_TOTAL)
  t.is(item?.value, 0)
})

test('handles a batch of single invocation without receipts', async t => {
  const { tableName } = await prepareResources(t.context.dynamoClient)
  const uploadService = await Signer.generate()
  const alice = await Signer.generate()
  const { spaceDid } = await createSpace(alice)
  const account = createAccount()
  const car = await randomCAR(128)

  const metricsTable = createMetricsTable(REGION, tableName, {
    endpoint: t.context.dbEndpoint
  })

  const invocations = [{
    carCid: car.cid.toString(),
    value: {
        att: [
          ProviderCapabilities.add.create({
            with: account.did(),
            nb: {
              provider: 'did:web:web3.storage"',
              consumer: spaceDid,
            }
          })
        ],
        aud: uploadService.did(),
        iss: alice.did()
    },
    type: STREAM_TYPE.WORKFLOW,
    ts: Date.now()
  }]

  // @ts-expect-error
  await updateProviderAddTotal(invocations, {
    metricsTable
  })

  const item = await getItemFromTable(t.context.dynamoClient, tableName, {
    name: METRICS_NAMES.PROVIDER_ADD_TOTAL
  })

  t.truthy(item)
  t.is(item?.name, METRICS_NAMES.PROVIDER_ADD_TOTAL)
  t.is(item?.value, 0)
})

/**
 * @param {import('@aws-sdk/client-dynamodb').DynamoDBClient} dynamoClient
 */
async function prepareResources (dynamoClient) {
  const [ tableName ] = await Promise.all([
    createDynamoTable(dynamoClient, adminMetricsTableProps),
  ])

  return {
    tableName
  }
}
