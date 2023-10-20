import { createReadableStoreClient } from './client.js'
import { decode, encodeKey } from '../data/subscription.js'

/**
 * @param {string} region 
 * @param {string} tableName
 * @param {object} [options]
 * @param {URL} [options.endpoint]
 */
export const createSubscriptionStore = (region, tableName, options) =>
  createReadableStoreClient({ region }, { tableName, encodeKey, decode })
