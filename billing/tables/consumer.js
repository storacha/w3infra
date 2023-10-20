import { createStoreListerClient } from './client.js'
import { encodeKey, decode } from '../data/consumer.js'

/**
 * @param {string} region 
 * @param {string} tableName
 * @param {object} [options]
 * @param {URL} [options.endpoint]
 * @returns {import('../types').ConsumerStore}
 */
export const createConsumerStore = (region, tableName, options) =>
  createStoreListerClient({ region }, { tableName, encodeKey, decode })
