import * as Server from '@ucanto/server'
import * as Store from '@web3-storage/access/capabilities/store'

/**
 * @typedef {import('@ucanto/interface').Link<unknown, number, number, 0 | 1>} Link
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
      const car = link.toString()
      const agent = invocation.issuer.did()
      const ucan = invocation.cid.toString() 
      const [
        verified,
        carIsLinkedToAccount,
        carExists
      ] = await Promise.all([
        context.access.verifyInvocation(invocation),
        context.storeTable.exists(space, car),
        context.carStoreBucket.has(car)
      ])

      if (!verified) {
        return new Server.Failure(`${agent} is not delegated capability ${Store.add.can} on ${space}`)
      }

      if (!carIsLinkedToAccount) {
        await context.storeTable.insert({
          space,
          car,
          size,
          origin: origin?.toString(),
          agent,
          ucan
        })
      }

      if (carExists) {
        return {
          status: 'done',
          with: space,
          link
        }
      }

      const { url, headers } = context.signer.sign(link)
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
