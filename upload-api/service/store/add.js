import * as Server from '@ucanto/server'
import * as Store from '@web3-storage/capabilities/store'

// https://docs.aws.amazon.com/AmazonS3/latest/userguide/upload-objects.html
export const MAX_S3_PUT_SIZE = 5_000_000_000

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

      if (size > MAX_S3_PUT_SIZE) {
        // checking this last, as larger CAR may alreaady exist in bucket from pinning service fetch.
        // we only want to prevent this here so we dont give the user a PUT url they can't use.
        return new Server.Failure(`Size must not exceed ${MAX_S3_PUT_SIZE}. Split CAR into smaller shards`)
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
