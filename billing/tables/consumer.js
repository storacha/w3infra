import { createStoreGetterClient, createStoreListerClient } from './client.js'
import { encodeKey, decode, lister } from '../data/consumer.js'

/**
 * @param {string} region 
 * @param {string} tableName
 * @param {object} [options]
 * @param {URL} [options.endpoint]
 * @returns {import('../lib/api').ConsumerStore}
 */
export const createConsumerStore = (region, tableName, options) => ({
  ...createStoreGetterClient({ region }, { tableName, encodeKey, decode }),
  ...createStoreListerClient({ region }, { tableName, ...lister, indexName: 'consumer' })
})
