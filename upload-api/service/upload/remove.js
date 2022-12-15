import * as Server from '@ucanto/server'
import * as Upload from '@web3-storage/capabilities/upload'

/**
 * @typedef {import('@web3-storage/capabilities/types').UploadRemove} UploadRemoveCapability
 * @typedef {import('../types').UploadRemoveResult} UploadRemoveResult
 * @typedef {import('@ucanto/interface').Failure} Failure
 */

/**
 * @param {import('../types').UploadServiceContext} context
 * @returns {import('@ucanto/interface').ServiceMethod<UploadRemoveCapability, UploadRemoveResult | undefined, Failure>}
 */
export function uploadRemoveProvider(context) {
  return Server.provide(
    Upload.remove,
    async ({ capability }) => {
      const { root } = capability.nb
      const space = Server.DID.parse(capability.with).did()

      return context.uploadTable.remove(space, root)
  })
}
