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

      // Only use capability account for now to check if account is registered.
      // This must change to access account/info!!
      // We need to use https://github.com/web3-storage/w3protocol/blob/9d4b5bec1f0e870233b071ecb1c7a1e09189624b/packages/access/src/agent.js#L270
      const account = capability.with

      const [
        carIsLinkedToAccount,
        carExists
      ] = await Promise.all([
        context.storeTable.exists(account, link.toString()),
        context.carStoreBucket.has(link.toString())
      ])

      if (!carIsLinkedToAccount) {
        await context.storeTable.insert({
          uploaderDID: account,
          link: link.toString(),
          proof: proof.toString(),
          origin: origin?.toString(),
          size
        })
      }

      if (carExists) {
        return {
          status: 'done',
          with: account,
          link
        }
      }

      const { url, headers } = context.signer.sign(link)
      return {
        status: 'upload',
        with: account,
        link,
        url,
        headers
      }
    }
  )
}
