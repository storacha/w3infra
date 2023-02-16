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
      const { cursor, size, pre } = capability.nb
      const space = Server.DID.parse(capability.with).did()

      return await context.storeTable.list(space, {
        size,
        cursor,
        pre
      })
    }
  )
}
