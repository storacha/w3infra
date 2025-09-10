import Big from 'big.js'
import { StoreOperationFailure } from '../../tables/lib.js'
import { EndOfQueue } from '../../test/helpers/queue.js'
import { productInfo } from '../../lib/product-info.js'

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
