import * as Server from '@ucanto/server'
import * as Upload from '@web3-storage/capabilities/upload'

/**
 * @typedef {import('@web3-storage/capabilities/types').UploadList} UploadListCapability
 * @typedef {import('@ucanto/interface').Failure} Failure
 * @typedef {import('../types').UploadListItem} UploadItemOutput
 * @typedef {import('../types').ListResponse<UploadItemOutput>} ListResponse
 */

/**
 * @param {import('../types').UploadServiceContext} context
 * @returns {import('@ucanto/interface').ServiceMethod<UploadListCapability, ListResponse, Failure>}
 */
export function uploadListProvider(context) {
  return Server.provide(
    Upload.list,
    async ({ capability }) => {
      const { cursor, size } = capability.nb

      // Only use capability account for now to check if account is registered.
      // This must change to access account/info!!
      // We need to use https://github.com/web3-storage/w3protocol/blob/9d4b5bec1f0e870233b071ecb1c7a1e09189624b/packages/access/src/agent.js#L270
      const space = Server.DID.parse(capability.with).did()

      return await context.uploadTable.list(space, {
        size,
        cursor
      })
  })
}
