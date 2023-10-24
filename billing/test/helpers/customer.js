import { randomAlphaNumerics } from './ascii.js'
import { randomLink } from './dag.js'
import { randomDIDMailto } from './did.js'
import { randomInteger } from './math.js'

/**
 * @param {Partial<import('../../lib/api').Customer>} [base]
 * @returns {import('../../lib/api').Customer}
 */
export const randomCustomer = (base = {}) => ({
  cause: randomLink(),
  customer: randomDIDMailto(),
  account: `stripe:cus_${randomAlphaNumerics(14)}`,
  product: ['starter', 'lite', 'business'][randomInteger(0, 3)],
  insertedAt: new Date(),
  updatedAt: new Date(),
  ...base
})
