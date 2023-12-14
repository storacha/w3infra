import { testConsumerWithBucket as test } from './helpers/context.js'

import { CBOR } from '@ucanto/core'
import * as Signer from '@ucanto/principal/ed25519'
import * as DealerCapabilities from '@web3-storage/capabilities/filecoin/dealer'
import * as StoreCapabilities from '@web3-storage/capabilities/store'
import { randomAggregate } from '@web3-storage/filecoin-api/test'

import { updateAggregateAcceptTotal } from '../metrics.js'

import { adminMetricsTableProps } from '@web3-storage/w3infra-ucan-invocation/tables/index.js'
import { METRICS_NAMES, STREAM_TYPE } from '@web3-storage/w3infra-ucan-invocation/constants.js'
import { createFilecoinMetricsTable } from '../store/metrics.js'
import { createWorkflowStore } from '../store/workflow.js'

import {
  createDynamodDb,
  createS3,
  createBucket,
} from './helpers/resources.js'
import { randomCAR } from '@web3-storage/w3infra-ucan-invocation/test/helpers/random.js'
import { createDynamoTable, getItemFromTable} from '@web3-storage/w3infra-ucan-invocation/test/helpers/tables.js'
import { createSpace } from '@web3-storage/w3infra-ucan-invocation/test/helpers/ucanto.js'

const REGION = 'us-west-2'

/**
 * @typedef {import('@web3-storage/data-segment').PieceLink} PieceLink
 * @typedef {import('@web3-storage/data-segment').AggregateView} AggregateView
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
  const { client, clientOpts } = await createS3()
  t.context.s3Client = client
  t.context.s3Opts = clientOpts
})

test('handles a batch of single invocation with aggregate/offer', async t => {
  const { tableName, bucketName } = await prepareResources(t.context.dynamoClient, t.context.s3Client)

  // Context
  const filecoinMetricsStore = createFilecoinMetricsTable(REGION, tableName, {
    endpoint: t.context.dbEndpoint
  })
  const workflowStore = createWorkflowStore(REGION, bucketName, t.context.s3Opts)

  // Invocation ctx
  const w3sService = await Signer.generate()
  const car = await randomCAR(128)

  // Generate aggregate for test
  const { pieces, aggregate } = await randomAggregate(100, 128)
  const offer = pieces.map((p) => p.link)
      const piecesBlock = await CBOR.write(offer)

  const invocations = [{
    carCid: car.cid.toString(),
    value: {
        att: [
          DealerCapabilities.aggregateAccept.create({
            with: w3sService.did(),
            nb: {
              aggregate: aggregate.link,
              pieces: piecesBlock.cid,
            }
          })
        ],
        aud: w3sService.did(),
          iss: w3sService.did()
    },
    type: STREAM_TYPE.RECEIPT,
    out: {
      ok: true
    },
    ts: Date.now()
  }]

  // @ts-expect-error not expecting type with just `aggregate/accept`
  await updateAggregateAcceptTotal(invocations, {
    workflowStore,
    filecoinMetricsStore
  })

  const aggregateOfferTotal = await getItemFromTable(t.context.dynamoClient, tableName, {
    name: METRICS_NAMES.AGGREGATE_ACCEPT_TOTAL
  })
  t.truthy(aggregateOfferTotal)
  t.is(aggregateOfferTotal?.name, METRICS_NAMES.AGGREGATE_ACCEPT_TOTAL)
  t.is(aggregateOfferTotal?.value, invocations.length)
})

test('handles a batch of single invocation with aggregate/accept', async t => {
  const { tableName, bucketName } = await prepareResources(t.context.dynamoClient, t.context.s3Client)

  // Context
  const filecoinMetricsStore = createFilecoinMetricsTable(REGION, tableName, {
    endpoint: t.context.dbEndpoint
  })
  const workflowStore = createWorkflowStore(REGION, bucketName, t.context.s3Opts)

  // Invocation ctx
  const w3sService = await Signer.generate()
  const car = await randomCAR(128)

  // Generate aggregate for test
  const { pieces, aggregate } = await randomAggregate(100, 128)
  const offer = pieces.map((p) => p.link)
      const piecesBlock = await CBOR.write(offer)

  const invocations = [{
    carCid: car.cid.toString(),
    value: {
        att: [
          DealerCapabilities.aggregateAccept.create({
            with: w3sService.did(),
            nb: {
              aggregate: aggregate.link,
              pieces: piecesBlock.cid,
            }
          })
        ],
        aud: w3sService.did(),
          iss: w3sService.did()
    },
    type: STREAM_TYPE.RECEIPT,
    out: {
      ok: true
    },
    ts: Date.now()
  }]

  // @ts-expect-error not expecting type with just `aggregate/accept`
  await updateAggregateAcceptTotal(invocations, {
    workflowStore,
    filecoinMetricsStore
  })

  const aggregateOfferTotal = await getItemFromTable(t.context.dynamoClient, tableName, {
    name: METRICS_NAMES.AGGREGATE_ACCEPT_TOTAL
  })
  t.truthy(aggregateOfferTotal)
  t.is(aggregateOfferTotal?.name, METRICS_NAMES.AGGREGATE_ACCEPT_TOTAL)
  t.is(aggregateOfferTotal?.value, invocations.length)
})

test('handles a batch of single invocation without aggregate/accept', async t => {
  const { tableName, bucketName } = await prepareResources(t.context.dynamoClient, t.context.s3Client)

  // Context
  const filecoinMetricsStore = createFilecoinMetricsTable(REGION, tableName, {
    endpoint: t.context.dbEndpoint
  })
  const workflowStore = createWorkflowStore(REGION, bucketName, t.context.s3Opts)

  // Invocation ctx
  const uploadService = await Signer.generate()
  const alice = await Signer.generate()
  const { spaceDid } = await createSpace(alice)
  const car = await randomCAR(128)

  const invocations = [{
    carCid: car.cid.toString(),
    value: {
        att: [
          StoreCapabilities.remove.create({
            with: spaceDid,
            nb: {
              link: car.cid,
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

  // @ts-expect-error not expecting type with just `aggregate/accept`
  await updateAggregateAcceptTotal(invocations, {
    workflowStore,
    filecoinMetricsStore
  })

  const aggregateOfferTotal = await getItemFromTable(t.context.dynamoClient, tableName, {
    name: METRICS_NAMES.AGGREGATE_ACCEPT_TOTAL
  })
  t.truthy(aggregateOfferTotal)
  t.is(aggregateOfferTotal?.name, METRICS_NAMES.AGGREGATE_ACCEPT_TOTAL)
  t.is(aggregateOfferTotal?.value, 0)
})

test('handles a batch of single invocation with aggregate/accept without receipts', async t => {
  const { tableName, bucketName } = await prepareResources(t.context.dynamoClient, t.context.s3Client)

  // Context
  const filecoinMetricsStore = createFilecoinMetricsTable(REGION, tableName, {
    endpoint: t.context.dbEndpoint
  })
  const workflowStore = createWorkflowStore(REGION, bucketName, t.context.s3Opts)

  // Invocation ctx
  const w3sService = await Signer.generate()
  const car = await randomCAR(128)

  // Generate aggregate for test
  const { pieces, aggregate } = await randomAggregate(100, 128)
  const offer = pieces.map((p) => p.link)
      const piecesBlock = await CBOR.write(offer)

  const invocations = [{
    carCid: car.cid.toString(),
    value: {
        att: [
          DealerCapabilities.aggregateAccept.create({
            with: w3sService.did(),
            nb: {
              aggregate: aggregate.link,
              pieces: piecesBlock.cid,
            }
          })
        ],
        aud: w3sService.did(),
          iss: w3sService.did()
    },
    type: STREAM_TYPE.WORKFLOW,
    out: {
      ok: true
    },
    ts: Date.now()
  }]

  // @ts-expect-error not expecting type with just `aggregate/accept`
  await updateAggregateAcceptTotal(invocations, {
    workflowStore,
    filecoinMetricsStore
  })

  const aggregateOfferTotal = await getItemFromTable(t.context.dynamoClient, tableName, {
    name: METRICS_NAMES.AGGREGATE_ACCEPT_TOTAL
  })
  t.truthy(aggregateOfferTotal)
  t.is(aggregateOfferTotal?.name, METRICS_NAMES.AGGREGATE_ACCEPT_TOTAL)
  t.is(aggregateOfferTotal?.value, 0)
})

/**
 * @param {import('@aws-sdk/client-dynamodb').DynamoDBClient} dynamoClient
 * @param {import('@aws-sdk/client-s3').S3Client} s3Client
 */
async function prepareResources (dynamoClient, s3Client) {
  const [ tableName, bucketName ] = await Promise.all([
    createDynamoTable(dynamoClient, adminMetricsTableProps),
    createBucket(s3Client)
  ])

  return {
    bucketName,
    tableName
  }
}
