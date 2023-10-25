import { asDIDWeb } from '../../data/lib.js'
import { randomLink } from './dag.js'
import { randomDIDMailto } from './did.js'
import { randomInteger } from './math.js'

/**
 * @param {Partial<import('../../lib/api').Subscription>} [base]
 * @returns {Promise<import('../../lib/api').Subscription>}
 */
export const randomSubscription = async (base = {}) => ({
  customer: randomDIDMailto(),
  provider: asDIDWeb(['did:web:web3.storage', 'did:web:nft.storage'][randomInteger(0, 2)]),
  subscription: randomLink().toString(),
  cause: randomLink(),
  insertedAt: new Date(),
  updatedAt: new Date(),
  ...base
})
