import * as Server from '@ucanto/server'
import * as Upload from '@web3-storage/access/capabilities/upload'

/**
 * @typedef {import('@web3-storage/access/types').UploadAdd} UploadAddCapability
 * @typedef {import('@ucanto/interface').Failure} Failure
 * @typedef {import('../types').UploadAddResult} UploadAddResult
 */

/**
 * @param {import('../types').UploadServiceContext} context
 * @returns {import('@ucanto/interface').ServiceMethod<UploadAddCapability, UploadAddResult, Failure>}
 */
export function uploadAddProvider(context) {
  return Server.provide(
    Upload.add,
    async ({ capability, invocation }) => {
      const { root, shards } = capability.nb

      // Only use capability account for now to check if account is registered.
      // This must change to access account/info!!
      // We need to use https://github.com/web3-storage/w3protocol/blob/9d4b5bec1f0e870233b071ecb1c7a1e09189624b/packages/access/src/agent.js#L270
      const space = capability.with

      const res = await context.uploadTable.insert({
        space,
        root: root.toString(),
        shards: shards?.map(s => s.toString()) || [],
        agent: invocation.issuer.did(),
        ucan: invocation.cid.toString()
      })

      // TODO: write mapping to DUDEWHERE

      return res
  })
}
