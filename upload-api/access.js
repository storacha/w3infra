import { Space } from '@web3-storage/capabilities'
import * as Client from '@ucanto/client'
import * as Server from '@ucanto/server'
import { CAR } from '@ucanto/transport'
import { info } from '@web3-storage/upload-api/space'

/**
 * @param {import('@ucanto/interface').Signer} issuer Issuer of UCAN invocations to the Access service.
 * @param {import('@ucanto/interface').Principal} servicePrincipal Principal signer of the Access service.
 * @param {import('@web3-storage/upload-api').ProvisionsStorage} provisionsStorage
 * @param {import('@web3-storage/upload-api').DelegationsStorage} delegationsStorage
 * @returns {import('@web3-storage/upload-api').AccessVerifier}
 */
export function createAccessClient (issuer, servicePrincipal, provisionsStorage, delegationsStorage) {
  const ctx = { provisionsStorage, delegationsStorage }
  /** @type {Server.ServerView<import('./types').SpaceService>} */
  const server = Server.create({
    id: issuer,
    codec: CAR.inbound,
    service: {
      space: {
        info: Server.provide(Space.info, (input) => info(input, ctx))
      }
    }
  })
  const conn = Client.connect({
    id: issuer,
    codec: CAR.outbound,
    channel: server,
  })

  return {
    async allocateSpace(invocation) {
      if (!invocation.capabilities.length) return { ok: {} }
      // if info capability is derivable from the passed capability, then we'll
      // receive a response and know that the invocation issuer has verified
      // themselves with w3access.
      const { out: result } = await Space.info
        .invoke({
          issuer,
          audience: servicePrincipal,
          // @ts-expect-error
          with: invocation.capabilities[0].with,
          proofs: [invocation],
        })
        .execute(conn)
      if (result.error) console.error(result.error)
      return result.error ? ({
        error: new Server.Failure(`Failed to get info about space, could not allocate.`, {
          cause: result.error
        })
      }) : { ok: {} };
    },
  }
}
