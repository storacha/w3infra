import { createQueueClient } from './client.js'
import { encode, validate } from '../data/billing-instruction.js'

/**
 * @param {string} region 
 * @param {string} table
 * @param {object} [options]
 * @param {URL} [options.endpoint]
 */
export const createBillingQueue = (region, table, options) => {
  return createQueueClient({ region }, {
    endpoint: options?.endpoint,
    encode,
    validate
  })
}
