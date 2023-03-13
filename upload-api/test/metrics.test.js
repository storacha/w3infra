import { testMetrics as test } from './helpers/context.js'

import {
  PutItemCommand,
} from '@aws-sdk/client-dynamodb'
import { marshall } from '@aws-sdk/util-dynamodb'
import { adminMetricsTableProps } from '@web3-storage/w3infra-ucan-invocation/tables/index.js'
import { METRICS_NAMES } from '@web3-storage/w3infra-ucan-invocation/constants.js'

import {
  createDynamodDb,
  createTable,
} from './helpers/resources.js'

import { useMetricsTable } from '../tables/metrics.js'
import { getMetrics } from '../functions/metrics.js'

test.before(async t => {
  const dynamo = await createDynamodDb()
  const tableName = await createTable(dynamo, adminMetricsTableProps)

  const metricsTable = useMetricsTable(
    dynamo,
    tableName
  )

  Object.assign(t.context, {
    dynamo,
    metricsTable,
    tableName
  })
})

test('can get all metrics with expected values', async t => {
  const { dynamo, tableName, metricsTable } = t.context
  const testValue = 1111

  // pre-populate database
  await Promise.all(Object.values(METRICS_NAMES).map(async name => {
    const cmd = new PutItemCommand({
      TableName: tableName,
      Item: marshall({
        name,
        value: testValue
      })
    })

    await dynamo.send(cmd)
  }))

  const metrics = await getMetrics(metricsTable)

  t.is(Object.values(metrics).length, Object.values(METRICS_NAMES).length)
  for (const [, value] of Object.entries(metrics)) {
    t.is(value, testValue)
  }
})
