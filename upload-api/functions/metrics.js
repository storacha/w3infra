import * as Sentry from '@sentry/serverless'
import * as Prom from 'prom-client'

import {
  METRICS_NAMES,
  STORE_ADD,
  STORE_REMOVE,
  UPLOAD_ADD,
  UPLOAD_REMOVE
} from '@web3-storage/w3infra-ucan-invocation/constants.js'

import { createMetricsTable } from '../tables/metrics.js'

Sentry.AWSLambda.init({
  environment: process.env.SST_STAGE,
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 1.0,
})

const AWS_REGION = process.env.AWS_REGION || 'us-west-2'
export const METRICS_CACHE_MAX_AGE = 10 * 60

/**
 * AWS HTTP Gateway handler for GET /metrics
 */
export async function metricsGet () {
  const {
    ADMIN_METRICS_TABLE_NAME: adminTableName = '',
    // set for testing
    DYNAMO_DB_ENDPOINT: dbEndpoint,
  } = process.env

  const metricsTable = createMetricsTable(AWS_REGION, adminTableName, {
    endpoint: dbEndpoint
  })
  const { registry, metrics } = createRegistry()
  await recordMetrics(metrics, metricsTable)
  registry.metrics()

  return {
    statusCode: 200,
    headers: {
      'Cache-Control': `public, max-age=${METRICS_CACHE_MAX_AGE}`
    },
    body: await registry.metrics()
  }
}

/**
 * @param {import('../tables/metrics.js').MetricsTable} metricsTable
 */
export async function getMetrics (metricsTable) {
  const metricsList = await metricsTable.get()

  return metricsList.reduce((obj, item) => Object.assign(obj, { [item.name]: item.value }), {})
}

/**
 * @param {Metrics} metrics
 * @param {import('../tables/metrics.js').MetricsTable} metricsTable
 */
export async function recordMetrics (metrics, metricsTable) {
  const fetchedMetrics = await getMetrics(metricsTable)

  // invocations size
  metrics.bytes.inc({ 'can': STORE_ADD }, fetchedMetrics[METRICS_NAMES.STORE_ADD_SIZE_TOTAL] || 0)
  metrics.bytes.inc({ 'can': STORE_REMOVE }, fetchedMetrics[METRICS_NAMES.STORE_REMOVE_SIZE_TOTAL] || 0)

  // invocations count
  metrics.invocations.inc({ 'can': STORE_ADD }, fetchedMetrics[METRICS_NAMES.STORE_ADD_TOTAL] || 0)
  metrics.invocations.inc({ 'can': STORE_REMOVE }, fetchedMetrics[METRICS_NAMES.STORE_REMOVE_TOTAL] || 0)
  metrics.invocations.inc({ 'can': UPLOAD_ADD }, fetchedMetrics[METRICS_NAMES.UPLOAD_ADD_TOTAL] || 0)
  metrics.invocations.inc({ 'can': UPLOAD_REMOVE }, fetchedMetrics[METRICS_NAMES.UPLOAD_REMOVE_TOTAL] || 0)
}

/**
 * @typedef {object} Metrics
 * @property {Prom.Counter<'can'>} bytes
 * @property {Prom.Counter<'can'>} invocations
 */

function createRegistry (ns = 'w3up') {
  const registry = new Prom.Registry()
  return {
    registry,
    metrics: {
      bytes: new Prom.Counter({
        name: `${ns}_bytes`,
        help: 'Total bytes associated with each invocation.',
        labelNames: ['can'],
        registers: [registry]
      }),
      invocations: new Prom.Counter({
        name: `${ns}_invocations_total`,
        help: 'Total number of invocations.',
        labelNames: ['can'],
        registers: [registry]
      }),
    }
  }
}

export const handler = Sentry.AWSLambda.wrapHandler(metricsGet)