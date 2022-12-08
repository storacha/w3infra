import * as Server from '@ucanto/server'
import * as Store from '@web3-storage/capabilities/store'

/**
 * @typedef {import('../types').AnyLink} Link
 * @typedef {import('@web3-storage/access/types').StoreAdd} StoreAddCapability
 * @typedef {import('@ucanto/interface').Failure} Failure
 * @typedef {import('../types').StoreAddResult} StoreAddResult
 */

/**
 * @param {import('../types').StoreServiceContext} context
 * @returns {import('@ucanto/interface').ServiceMethod<StoreAddCapability, StoreAddResult, Failure>}
 */
export function storeAddProvider(context) {
  return Server.provide(
    Store.add,
    async ({ capability, invocation }) => {
      const { link, origin, size } = capability.nb
      const space = Server.DID.parse(capability.with).did()
      const issuer = invocation.issuer.did()
      const [
        verified,
        carIsLinkedToAccount,
        carExists
      ] = await Promise.all([
        context.access.verifyInvocation(invocation),
        context.storeTable.exists(space, link),
        context.carStoreBucket.has(link)
      ])

      if (!verified) {
        return new Server.Failure(`${issuer} is not delegated capability ${Store.add.can} on ${space}`)
      }

      if (!carIsLinkedToAccount) {
        await context.storeTable.insert({
          space,
          link,
          size,
          origin,
          issuer,
          invocation: invocation.cid,
        })
      }

      if (carExists) {
        return {
          status: 'done',
          with: space,
          link
        }
      }

      const { url, headers } = await context.carStoreBucket.createUploadUrl(link, size)
      return {
        status: 'upload',
        with: space,
        link,
        url,
        headers
      }
    }
  )
}
