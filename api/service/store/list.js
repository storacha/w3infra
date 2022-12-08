import * as Server from '@ucanto/server'
import * as Store from '@web3-storage/capabilities/store'

/**
 * @typedef {import('@ucanto/interface').Link<unknown, number, number, 0 | 1>} Link
 * @typedef {import('@web3-storage/capabilities/types').StoreList} StoreListCapability
 * @typedef {import('@ucanto/interface').Failure} Failure
 * @typedef {import('../types').StoreListItem} StoreListItem
 * @typedef {import('../types').ListResponse<StoreListItem>} ListResponse
 */

/**
 * @param {import('../types').StoreServiceContext} context
 * @returns {import('@ucanto/interface').ServiceMethod<StoreListCapability, ListResponse, Failure>}
 */
export function storeListProvider(context) {
  return Server.provide(
    Store.list,
    async ({ capability }) => {
      const { cursor, size } = capability.nb

      // Only use capability account for now to check if account is registered.
      // This must change to access account/info!!
      // We need to use https://github.com/web3-storage/w3protocol/blob/9d4b5bec1f0e870233b071ecb1c7a1e09189624b/packages/access/src/agent.js#L270
      const space = Server.DID.parse(capability.with).did()

      return await context.storeTable.list(space, {
        size,
        cursor
      })
    }
  )
}
