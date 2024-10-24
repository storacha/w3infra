import { randomLink } from './dag.js'
import { randomDID } from './did.js'

/**
 * @param {import('../../lib/api').Customer} customer
 * @returns {Promise<import('../../lib/api').EgressTrafficData>}
 */
export const randomEgressEvent = async (customer) => ({
  space: await randomDID(),
  customer: customer.customer,
  resource: randomLink(),
  bytes: Math.floor(Math.random() * 1000000),
  // Random timestamp within the last 1 hour
  servedAt: new Date(Date.now() - Math.floor(Math.random() * 60 * 60 * 1000)),
  cause: randomLink()
})
