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
      const space = Server.DID.parse(capability.with).did()

      return await context.uploadTable.list(space, {
        size,
        cursor
      })
  })
}
