import { getTableItem, getAllTableRows } from './table.js'

/**
 * @param {import("ava").ExecutionContext<import("./context.js").MetricsContext>} t
 */
export async function getMetrics (t) {
  const metrics = await getAllTableRows(
    t.context.metricsDynamo.client,
    t.context.metricsDynamo.tableName
  )

  return metrics
}

/**
 * @param {import("ava").ExecutionContext<import("./context.js").MetricsContext>} t
 * @param {`did:${string}:${string}`} spaceDid
 * @param {string} name
 */
export async function getSpaceMetrics (t, spaceDid, name) {
  const item = await getTableItem(
    t.context.spaceMetricsDynamo.client,
    t.context.spaceMetricsDynamo.tableName,
    { space: spaceDid, name }
  )

  return item
}
