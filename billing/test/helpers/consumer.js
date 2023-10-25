import { asDIDWeb } from '../../data/lib.js'
import { randomLink } from './dag.js'
import { randomDID } from './did.js'
import { randomInteger } from './math.js'

/**
 * @param {Partial<import('../../lib/api').Consumer>} [base]
 * @returns {Promise<import('../../lib/api').Consumer>}
 */
export const randomConsumer = async (base = {}) => ({
  consumer: await randomDID(),
  provider: asDIDWeb(['did:web:web3.storage', 'did:web:nft.storage'][randomInteger(0, 2)]),
  subscription: randomLink().toString(),
  cause: randomLink(),
  insertedAt: new Date(),
  updatedAt: new Date(),
  ...base
})
