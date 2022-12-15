import * as Server from '@ucanto/server'
import * as Store from '@web3-storage/capabilities/store'

/**
 * @typedef {import('@ucanto/interface').Link<unknown, number, number, 0 | 1>} Link
 * @typedef {import('@web3-storage/capabilities/types').StoreRemove} StoreRemoveCapability
 * @typedef {import('@ucanto/interface').Failure} Failure
 */

/**
 * @param {import('../types').StoreServiceContext} context
 * @returns {import('@ucanto/interface').ServiceMethod<StoreRemoveCapability, void, Failure>}
 */
export function storeRemoveProvider(context) {
  return Server.provide(
    Store.remove,
    async ({ capability }) => {
      const { link } = capability.nb
      const space = Server.DID.parse(capability.with).did()

      await context.storeTable.remove(space, link)
    }
  )
}
