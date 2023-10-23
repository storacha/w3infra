import { createQueueClient } from './client.js'
import { encode, validate } from '../data/space-billing-instruction.js'

/**
 * @param {string} region
 * @param {object} [options]
 * @param {URL} [options.endpoint]
 */
export const createSpaceBillingQueue = (region, options) => {
  return createQueueClient({ region }, {
    endpoint: options?.endpoint,
    encode,
    validate
  })
}
