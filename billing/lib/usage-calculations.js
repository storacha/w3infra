import Big from 'big.js'
import { GB, ONE_DAY_MS, isMonthStart, startOfMonth, sleep } from './util.js'

/**
 * Attempts to find previous usage using 24-hour lookup optimization.
 * This is the fast path for daily billing (single DynamoDB GetItem).
 *
 * @private
 * @param {{
 *   customer: `did:mailto:${string}`,
 *   space: `did:${string}:${string}`,
 *   provider: `did:web:${string}`,
 *   targetDate: Date
 * }} params
 * @param {{ usageStore: import('./api.js').UsageStore }} ctx
 * @returns {Promise<{ usage: bigint, found: boolean } | null>} Previous usage if found via 24h lookup, null otherwise
 */
async function tryQuickLookup(params, ctx) {
  const { customer, space, provider, targetDate } = params

  const previousFrom = new Date(targetDate.getTime() - ONE_DAY_MS)
  const quickLookup = await ctx.usageStore.get({
    customer,
    from: previousFrom,
    provider,
    space
  })

  if (quickLookup.ok) {
    // Verify this record's 'to' matches our targetDate (it should for daily billing)
    if (quickLookup.ok.to.getTime() === targetDate.getTime()) {
      console.log(`Found previous cumulative via 24h lookback (to=${quickLookup.ok.to.toISOString()}): ${quickLookup.ok.usage} byte·ms`, { space, provider })
      return { usage: quickLookup.ok.usage, found: true }
    }
    console.log(`24h lookback found record but 'to' doesn't match (expected ${targetDate.toISOString()}, got ${quickLookup.ok.to.toISOString()}).`, { space, provider })
  }

  if (quickLookup.error && quickLookup.error.name !== 'RecordNotFound') {
    throw quickLookup.error
  }

  return null
}

/**
 * Scans usage records for the customer to find the record matching the target date.
 * Uses adaptive pacing to reduce DynamoDB throttling risk.
 *
 * @private
 * @param {{
 *   customer: `did:mailto:${string}`,
 *   space: `did:${string}:${string}`,
 *   provider: `did:web:${string}`,
 *   targetDate: Date
 * }} params
 * @param {{ usageStore: import('./api.js').UsageStore }} ctx
 * @returns {Promise<{ usage: bigint, found: boolean }>} Previous usage result
 */
async function scanForPreviousUsage(params, ctx) {
  const { customer, space, provider, targetDate } = params

  console.log('Scanning for previous usage...', { space, provider })

  // We're looking for a usage record where to === targetDate
  // for this specific space/provider combination.
  // Since 'to' is not part of the key, we must list and filter in code. (TODO: create an GSI later)

  const targetTs = targetDate.getTime()
  const monthBeforeTarget = new Date(targetTs - 32 * ONE_DAY_MS)
  const monthBeforeTs = monthBeforeTarget.getTime() 

  let cursor
  let totalScanned = 0
  let pageCount = 0
  while (true) {
    // Adaptive pacing: add delay between pages to reduce DynamoDB read pressure
    if (pageCount > 0) {
      const baseDelay = 20
      const maxDelay = 250

      const delay = Math.min(baseDelay * 2 ** pageCount, maxDelay)
      const jitter = Math.random() * delay

      await sleep(jitter)
    }

    const listResult = await ctx.usageStore.list({customer}, { size: 50, scanIndexForward: false, cursor })

    if (listResult.error) {
      throw listResult.error
    }

    totalScanned += listResult.ok.results.length
    pageCount++

    // Find the record where to === targetDate for this specific space
    const previousRecord = listResult.ok.results.find(
      record =>
        record.space === space &&
        record.provider === provider &&
        record.to.getTime() === targetTs
    )

    if (previousRecord) {
      console.log(`Found previous cumulative (to=${previousRecord.to.toISOString()}): ${previousRecord.usage} byte·ms (scanned ${totalScanned} records)`, { space, provider })
      return { usage: previousRecord.usage, found: true }
    }

    // Early termination: if all records in this page are older than ~1 month before target,
    // we've scanned too far back (billing periods don't exceed 1 month)
    const allRecordsTooOld = listResult.ok.results.length > 0 &&
      listResult.ok.results.every(record => record.from.getTime() < monthBeforeTs)

    if (allRecordsTooOld) {
      console.warn(
        `Stopped scanning: all records older than ${monthBeforeTarget.toISOString()}. ` +
        `No usage record found with to=${targetDate.toISOString()} ` +
        `for space ${space} and provider ${provider}, returning 0n (not found, scanned ${totalScanned} records)`
      )
      return { usage: 0n, found: false }
    }

    // No more records to scan
    if (!listResult.ok.cursor) {
      console.warn(
        `No usage record found with to=${targetDate.toISOString()} ` +
        `for space ${space} and provider ${provider}, returning 0n (scanned all ${totalScanned} records)`
      )
      return { usage: 0n, found: false }
    }

    cursor = listResult.ok.cursor
  }
}

/**
 * Finds the previous usage record that created the snapshot at targetDate.
 * Returns 0n for first of month (cumulative usage resets).
 * Uses optimized 24h lookup first (single GetItem), then falls back to
 * paginated scan if not found or if the record doesn't match.
 *
 * This is the core logic shared between space billing queue processing
 * and usage table Stripe reporting.
 *
 * @param {{
 *   customer: `did:mailto:${string}`,
 *   space: `did:${string}:${string}`,
 *   provider: `did:web:${string}`,
 *   targetDate: Date
 * }} params
 * @param {{ usageStore: import('./api.js').UsageStore }} ctx
 * @returns {Promise<{ usage: bigint, found: boolean }>} Previous cumulative usage and whether a record was found
 */
export const findPreviousUsageBySnapshotDate = async (params, ctx) => {
  const { space, provider, targetDate } = params

  // First of month - cumulative usage resets to 0
  if (isMonthStart(targetDate)) {
    console.log('First of month, cumulative usage resets to 0', { space, provider })
    return { usage: 0n, found: true }
  }

  // Tier 1: Try fast 24-hour lookup (single GetItem)
  const quickResult = await tryQuickLookup(params, ctx)
  if (quickResult) {
    return quickResult
  }

  // Tier 2: Fallback to paginated scan
  return scanForPreviousUsage(params, ctx)
}

/**
 * Calculate the delta metrics that would be sent to Stripe.
 *
 * Converts cumulative byte-millisecond usage into:
 * - Current cumulative average (bytes/month from month start to now)
 * - Previous cumulative average (bytes/month from month start to yesterday)
 * - Delta between them (what gets sent to Stripe)
 *
 * @param {bigint} usageByteMs - Current day's cumulative usage in byte·milliseconds
 * @param {Date} from - Start of billing period (inclusive)
 * @param {Date} to - End of billing period (exclusive)
 * @param {bigint} previousCumulativeUsage - Previous day's cumulative usage (0n if first of month or not found)
 * @returns {{
 *   cumulativeByteQuantity: number,
 *   previousCumulativeByteQuantity: number,
 *   deltaByteQuantity: number,
 *   deltaGibQuantity: number,
 *   currentCumulativeDuration: number,
 *   previousCumulativeDuration: number
 * }}
 */
export function calculateDeltaMetrics(usageByteMs, from, to, previousCumulativeUsage) {
  // Calculate cumulative averages from month start
  const monthStart = startOfMonth(from)
  const currentCumulativeDuration = to.getTime() - monthStart.getTime()
  const previousCumulativeDuration = from.getTime() - monthStart.getTime()

  // Current cumulative average (from month start to now)
  const cumulativeByteQuantity = Math.floor(
    new Big(usageByteMs.toString()).div(currentCumulativeDuration).toNumber()
  )

  // Previous cumulative average (from month start to yesterday)
  const previousCumulativeByteQuantity =
    previousCumulativeUsage === 0n
      ? 0
      : Math.floor(new Big(previousCumulativeUsage.toString()).div(previousCumulativeDuration).toNumber())

  // Delta to send to Stripe: difference between cumulative averages
  // Stripe sums these deltas across the month to get the month-to-date average
  const deltaByteQuantity = cumulativeByteQuantity - previousCumulativeByteQuantity
  const deltaGibQuantity = deltaByteQuantity / GB

  return {
    cumulativeByteQuantity,
    previousCumulativeByteQuantity,
    deltaByteQuantity,
    deltaGibQuantity,
    currentCumulativeDuration,
    previousCumulativeDuration,
  }
}
