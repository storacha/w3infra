import * as Server from '@ucanto/server'
import * as Store from '@web3-storage/access/capabilities/store'

/**
 * @typedef {import('@ucanto/interface').Link<unknown, number, number, 0 | 1>} Link
 * @typedef {import('@web3-storage/access/types').StoreRemove} StoreRemoveCapability
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
      // Only use capability account for now to check if account is registered.
      // This must change to access account/info!!
      // We need to use https://github.com/web3-storage/w3protocol/blob/9d4b5bec1f0e870233b071ecb1c7a1e09189624b/packages/access/src/agent.js#L270
      const space = capability.with

      await context.storeTable.remove(space, link.toString())
    }
  )
}
