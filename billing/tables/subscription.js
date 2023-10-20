import { createStoreGetterClient, createStoreListerClient } from './client.js'
import { decode, encodeKey, encodeListKey } from '../data/subscription.js'

/**
 * @param {string} region 
 * @param {string} tableName
 * @param {object} [options]
 * @param {URL} [options.endpoint]
 * @returns {import('../types').SubscriptionStore}
 */
export const createSubscriptionStore = (region, tableName, options) => ({
  ...createStoreGetterClient({ region }, { tableName, encodeKey, decode }),
  ...createStoreListerClient({ region }, { tableName, encodeKey: encodeListKey, decode, indexName: 'customer' })
})
