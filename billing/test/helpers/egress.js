import { randomLink } from './dag.js'

/**
 * @param {import('../../lib/api').Customer} customer
 * @returns {import('../../lib/api').EgressTrafficData}
 */
export const randomEgressEvent = (customer) => ({
  customer: customer.customer,
  resource: randomLink(),
  bytes: BigInt(Math.floor(Math.random() * 1000000)),
  // Random timestamp within the last 1 hour
  servedAt: new Date(Date.now() - Math.floor(Math.random() * 60 * 60 * 1000))
})
