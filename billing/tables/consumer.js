import { createPaginatedStoreClient } from './client.js'
import { encodeKey, decode } from '../data/consumer.js'

/**
 * @param {string} region 
 * @param {string} tableName
 * @param {object} [options]
 * @param {URL} [options.endpoint]
 */
export const createConsumerStore = (region, tableName, options) =>
  createPaginatedStoreClient({ region }, { tableName, encodeKey, decode })
