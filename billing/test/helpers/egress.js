import { randomDID } from './did.js'
import { randomLink } from './dag.js'

/**
 * @param {Partial<import('../../lib/api').EgressEvent>} [base]
 * @returns {Promise<import('../../lib/api').EgressEvent>}
 */
export const randomEgressEvent = async (base = {}) => ({
    customerId: await randomDID(),
    resourceId: randomLink().toString(),
    timestamp: new Date(),
    ...base
})