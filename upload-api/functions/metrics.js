import * as Sentry from '@sentry/serverless'
import { METRICS_NAMES } from '@web3-storage/w3infra-ucan-invocation/constants.js'
import { METRICS_PROM } from '../constants.js'

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

  const metrics = await getMetrics({
    metricsTable: createMetricsTable(AWS_REGION, adminTableName, {
      endpoint: dbEndpoint
    })
  })

  // conversion to prometheus format
  const promMetrics = [
    `# HELP ${METRICS_PROM.STORE_ADD_SIZE_TOTAL} Total bytes committed to be stored.`,
    `# TYPE ${METRICS_PROM.STORE_ADD_SIZE_TOTAL} counter`,
    `${METRICS_PROM.STORE_ADD_SIZE_TOTAL} ${metrics[METRICS_NAMES.STORE_ADD_SIZE_TOTAL] || 0}`,
  ]

  return {
    statusCode: 200,
    headers: {
      'Cache-Control': `public, max-age=${METRICS_CACHE_MAX_AGE}`
    },
    body: promMetrics.join('\n')
  }
}

/**
 * @param {{ metricsTable: { get: () => Promise<Record<string, any>[]>; }; }} ctx
 */
export async function getMetrics (ctx) {
  const metricsList = await ctx.metricsTable.get()

  return metricsList.reduce((obj, item) => Object.assign(obj, { [item.name]: item.value }), {})
}

export const handler = Sentry.AWSLambda.wrapHandler(metricsGet)
