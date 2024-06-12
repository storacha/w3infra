import * as Digest from 'multiformats/hashes/digest'
import { hasOkReceipt } from './utils.js'

import {
  BLOB_ADD,
  STORE_ADD,
  BLOB_REMOVE,
  STORE_REMOVE,
  UPLOAD_ADD,
  UPLOAD_REMOVE,
  METRICS_NAMES,
  SPACE_METRICS_NAMES,
} from './constants.js'

/**
 * @typedef {import('@ucanto/interface').Capability} Capability
 */

/**
 * Update total admin metrics for upload-api receipts.
 * Metrics:
 * - BLOB_ADD_TOTAL: increment number of `blob/add` success receipts
 * - BLOB_ADD_SIZE_TOTAL: increment size of `blob/add` success receipts
 * - STORE_ADD_TOTAL: increment number of `store/add` success receipts
 * - STORE_ADD_SIZE_TOTAL: increment size of `store/add` success receipts
 * - UPLOAD_ADD_TOTAL: increment number of `upload/add` success receipts
 * - BLOB_REMOVE_TOTAL: increment number of `blob/remove` success receipts
 * - BLOB_REMOVE_SIZE_TOTAL: increment size of `blob/remove` success receipts
 * - STORE_REMOVE_TOTAL: increment number of `store/remove` success receipts
 * - STORE_REMOVE_SIZE_TOTAL: increment size of `store/remove` success receipts
 * - UPLOAD_REMOVE_TOTAL: increment number of `upload/remove` success receipts
 * 
 * @param {import('./types.js').UcanStreamInvocation[]} ucanInvocations
 * @param {import('./types').MetricsCtx} ctx
 */
export async function updateAdminMetrics (ucanInvocations, ctx) {
  /**
   * @type {Map<string, Capability[]>}
   */
  const receipts = getReceiptPerCapability(ucanInvocations)

  // Append size for `store/remove` receipts
  const storeRemoveReceipts = await Promise.all((receipts.get(STORE_REMOVE) || []).map(async r => {
    const size = await ctx.carStore.getSize(r.nb?.link)

    r.nb.size = size
    return r
  }))

  // Append size for `blob/remove` receipts
  const blobRemoveReceipts = await Promise.all((receipts.get(BLOB_REMOVE) || []).map(async r => {
    const space = r.with
    const { digest } = r.nb

    // @ts-expect-error space string type different
    const blob = await ctx.allocationsStorage.get(space, Digest.decode(digest))
    r.nb.size = blob.ok?.blob.size
    return r
  }))

  await ctx.metricsStore.incrementTotals({
    [METRICS_NAMES.BLOB_ADD_TOTAL]: (receipts.get(BLOB_ADD) || []).length,
    [METRICS_NAMES.BLOB_ADD_SIZE_TOTAL]: (receipts.get(BLOB_ADD) || []).reduce(
      (acc, c) => acc + c.nb?.blob.size, 0
    ),
    [METRICS_NAMES.STORE_ADD_TOTAL]: (receipts.get(STORE_ADD) || []).length,
    [METRICS_NAMES.STORE_ADD_SIZE_TOTAL]: (receipts.get(STORE_ADD) || []).reduce(
      (acc, c) => acc + c.nb?.size, 0
    ),
    [METRICS_NAMES.UPLOAD_ADD_TOTAL]: (receipts.get(UPLOAD_ADD) || []).length,
    [METRICS_NAMES.BLOB_REMOVE_TOTAL]: (receipts.get(BLOB_REMOVE) || []).length,
    [METRICS_NAMES.BLOB_REMOVE_SIZE_TOTAL]: blobRemoveReceipts.reduce(
      (acc, c) => acc + c.nb?.size, 0
    ),
    [METRICS_NAMES.STORE_REMOVE_TOTAL]: (receipts.get(STORE_REMOVE) || []).length,
    [METRICS_NAMES.STORE_REMOVE_SIZE_TOTAL]: storeRemoveReceipts.reduce(
      (acc, c) => acc + c.nb?.size, 0
    ),
    [METRICS_NAMES.UPLOAD_REMOVE_TOTAL]: (receipts.get(UPLOAD_REMOVE) || []).length,
  })
}

/**
 * Update total space metrics for upload-api receipts.
 * Metrics:
 * - STORE_ADD_TOTAL: increment number of `store/add` success receipts for a space
 * - STORE_ADD_SIZE_TOTAL: increment size of `store/add` success receipts for a space
 * - UPLOAD_ADD_TOTAL: increment number of `upload/add` success receipts for a space
 * - STORE_REMOVE_TOTAL: increment number of `store/remove` success receipts for a space
 * - STORE_REMOVE_SIZE_TOTAL: increment size of `store/remove` success receipts for a space
 * - UPLOAD_REMOVE_TOTAL: increment number of `upload/remove` success receipts for a space
 * 
 * @param {import('./types.js').UcanStreamInvocation[]} ucanInvocations
 * @param {import('./types').SpaceMetricsCtx} ctx
 */
export async function updateSpaceMetrics (ucanInvocations, ctx) {
  const receipts = getReceiptPerCapability(ucanInvocations)

  // Append size for `store/remove` receipts
  const storeRemoveReceipts = await Promise.all((receipts.get(STORE_REMOVE) || []).map(async r => {
    const size = await ctx.carStore.getSize(r.nb?.link)

    r.nb.size = size
    return r
  }))

  // Append size for `blob/remove` receipts
  const blobRemoveReceipts = await Promise.all((receipts.get(BLOB_REMOVE) || []).map(async r => {
    const space = r.with
    const { digest } = r.nb

    // @ts-expect-error space string type different
    const blob = await ctx.allocationsStorage.get(space, digest)
    r.nb.size = blob.ok?.blob.size
    return r
  }))

  await ctx.metricsStore.incrementTotals({
    [SPACE_METRICS_NAMES.BLOB_ADD_TOTAL]: normalizeCapsPerSpaceTotal(receipts.get(BLOB_ADD) || []),
    [SPACE_METRICS_NAMES.BLOB_ADD_SIZE_TOTAL]: normalizeCapsPerSpaceSize(receipts.get(BLOB_ADD) || []),
    [SPACE_METRICS_NAMES.STORE_ADD_TOTAL]: normalizeCapsPerSpaceTotal(receipts.get(STORE_ADD) || []),
    [SPACE_METRICS_NAMES.STORE_ADD_SIZE_TOTAL]: normalizeCapsPerSpaceSize(receipts.get(STORE_ADD) || []),
    [SPACE_METRICS_NAMES.UPLOAD_ADD_TOTAL]: normalizeCapsPerSpaceTotal(receipts.get(UPLOAD_ADD) || []),
    [SPACE_METRICS_NAMES.BLOB_REMOVE_TOTAL]: normalizeCapsPerSpaceTotal(receipts.get(BLOB_REMOVE) || []),
    [SPACE_METRICS_NAMES.BLOB_REMOVE_SIZE_TOTAL]: normalizeCapsPerSpaceSize(blobRemoveReceipts),
    [SPACE_METRICS_NAMES.STORE_REMOVE_TOTAL]: normalizeCapsPerSpaceTotal(receipts.get(STORE_REMOVE) || []),
    [SPACE_METRICS_NAMES.STORE_REMOVE_SIZE_TOTAL]: normalizeCapsPerSpaceSize(storeRemoveReceipts),
    [SPACE_METRICS_NAMES.UPLOAD_REMOVE_TOTAL]: normalizeCapsPerSpaceTotal(receipts.get(UPLOAD_REMOVE) || []),
  })
}

/**
 * Reduce all capabilities executed of a given type by counting totals per space.
 * Merge same space operations into single one.
 *
 * @param {Capability[]} capabilities 
 */
function normalizeCapsPerSpaceTotal (capabilities) {
  const res = capabilities.reduce((acc, c) => {
    const existing = acc?.find((e) => c.with === e.space)
    if (existing) {
      existing.value += 1
    } else {
      acc.push({
        space: c.with,
        value: 1
      })
    }
    return acc
  }, /** @type {import('./types').SpaceMetricsItem[]} */ ([]))

  return res
}

/**
 * Reduce all capabilities executed of a given type by totals sizes per space.
 * Merge same space operations into single one.
 *
 * @param {Capability[]} capabilities 
 */
function normalizeCapsPerSpaceSize (capabilities) {
  const res = capabilities.reduce((acc, c) => {
    const existing = acc?.find((e) => c.with === e.space)
    if (existing) {
      existing.value += (c.nb?.size || c.nb?.blob?.size)
    } else {
      acc.push({
        space: c.with,
        value: (c.nb?.size || c.nb?.blob?.size)
      })
    }
    return acc
  }, /** @type {import('./types').SpaceMetricsItem[]} */ ([]))

  return res
}

/**
 * Get a map of receipts per capability.
 *
 * @param {import('./types.js').UcanStreamInvocation[]} ucanInvocations
 */
function getReceiptPerCapability (ucanInvocations) {
  return ucanInvocations
    .reduce(
      (acc, workflowInvocations) => {
        if (!hasOkReceipt(workflowInvocations)) {
          return acc
        }

        for (const invocation of workflowInvocations.value.att) {
          const current = acc.get(invocation.can) || []
          current.push(invocation)
          acc.set(invocation.can, current.map(c => ({
            ...c,
            out: workflowInvocations.out
          })))
        }

        return acc
      },
      /** @type {Map<string, Capability[]>} */ (new Map())
    )
}
