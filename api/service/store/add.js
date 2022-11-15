import * as Server from '@ucanto/server'
import * as Store from '@web3-storage/access/capabilities/store'

/**
 * @typedef {import('@ucanto/interface').Link<unknown, number, number, 0 | 1>} Link
 * @typedef {import('@web3-storage/access/types').StoreAdd} StoreAddCapability
 */

/**
 * @param {import('../types').StoreServiceContext} context
 */
export function storeAddProvider(context) {
  return Server.provide(
    Store.add,
    async ({ capability, invocation }) => {
      const { link, origin, size } = capability.nb
      const proof = invocation.cid

      if (!link) {
        return new Server.MalformedCapability(
          invocation.capabilities[0],
          new Server.Failure('Provided capability has no link')
        )
      } else if (!size) {
        return new Server.MalformedCapability(
          invocation.capabilities[0],
          new Server.Failure('Provided capability has no size')
        )
      }


      const resource = Server.DID.parse(capability.with).did()
      const [
        verified,
        carIsLinkedToAccount,
        carExists
      ] = await Promise.all([
        context.access.verifyInvocation(invocation),
        context.storeTable.exists(resource, link.toString()),
        context.carStoreBucket.has(link.toString())
      ])

      if (!verified) {
        return new Server.Failure(`${invocation.issuer.did()} is not delegated capability ${Store.add.can} on ${resource}`)
      }

      if (!carIsLinkedToAccount) {
        await context.storeTable.insert({
          uploaderDID: resource,
          link: link.toString(),
          proof: proof.toString(),
          origin: origin?.toString(),
          size
        })
      }

      if (carExists) {
        return {
          status: 'done',
          with: resource,
          link
        }
      }

      const { url, headers } = context.signer.sign(link)
      return {
        status: 'upload',
        with: resource,
        link,
        url,
        headers
      }
    }
  )
}
