import { randomDIDMailto } from './did.js'
import { randomLink } from './dag.js'

/**
 * @param {Partial<import('../../lib/api').EgressTrafficData>} [base]
 * @returns {Promise<import('../../lib/api').EgressTrafficData>}
 */
export const randomEgressEvent = async (base = {}) => ({
    customer: await randomDIDMailto(),
    resource: randomLink(),
    bytes: BigInt(Math.floor(Math.random() * 1000000)),
    servedAt: new Date(),
    ...base
})