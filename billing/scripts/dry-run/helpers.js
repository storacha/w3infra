import Big from 'big.js'
import { StoreOperationFailure } from '../../tables/lib.js'
import { EndOfQueue } from '../../test/helpers/queue.js'
import { productInfo } from '../../lib/product-info.js'
import { startOfMonth } from '../../lib/util.js'

/**
 * @template T
 * @returns {import('../../lib/api.js').QueueAdder<T> & import('../../test/lib/api.js').QueueRemover<T>}
 */
export const createMemoryQueue = () => {
  /** @type {T[]} */
  const items = []
  return {
    add: async (message) => {
      items.push(message)
      return { ok: {} }
    },
    remove: async () => {
      const item = items.shift()
      return item ? { ok: item } : { error: new EndOfQueue() }
    }
  }
}

/**
 * @template T
 * @returns {import('../../lib/api.js').StorePutter<T> & import('../../lib/api.js').StoreLister<any, T> & import('../../lib/api.js').StoreGetter<any, T>}
 */
export const createMemoryStore = () => {
  /** @type {T[]} */
  const items = []
  return {
    put: async (item) => {
      items.push(item)
      return { ok: {} }
    },
    get: async () => ({ error: new StoreOperationFailure('not implemented') }),
    list: async () => ({ ok: { results: items } })
  }
}

const GB = 1024 * 1024 * 1024

/**
 * @param {string} product
 * @param {bigint} usage Usage in bytes/ms
 * @param {number} duration Duration in ms
 */
export const calculateCost = (product, usage, duration) => {
  const info = productInfo[product]
  if (!info) throw new Error(`missing product info: ${product}`)

  let quantity = Math.floor(new Big(usage.toString()).div(duration).div(GB).toNumber())
  quantity = quantity - (info.included / GB)
  quantity = quantity < 0 ? 0 : quantity

  return info.cost + (quantity * GB * info.overage)
}

/** @param {Date} d */
export const toDateString = (d) => d.toISOString().split('T')[0]

/**
 * Calculate the delta metrics that would be sent to Stripe, matching production logic exactly.
 * This simulates what usage-table.js sends to Stripe.
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
      : Math.floor(
          new Big(previousCumulativeUsage.toString())
            .div(previousCumulativeDuration)
            .toNumber()
        )

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
