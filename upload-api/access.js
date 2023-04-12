import * as Space from '@web3-storage/capabilities/space'
import { connect } from '@ucanto/client'
import { Failure } from '@ucanto/server'
import { CAR, CBOR, HTTP } from '@ucanto/transport-legacy'
import fetch from '@web-std/fetch'

/**
 * @param {import('@ucanto/interface').Signer} issuer Issuer of UCAN invocations to the Access service.
 * @param {import('@ucanto/interface').Principal} serviceDID DID of the Access service.
 * @param {URL} serviceURL URL of the Access service.
 * @returns {import('@web3-storage/upload-api').AccessVerifier}
 */
export function createAccessClient(issuer, serviceDID, serviceURL) {
  /** @type {import('@ucanto/server').ConnectionView<import('@web3-storage/access/types').Service>} */
  const conn = connect({
    id: serviceDID,
    encoder: CAR,
    decoder: CBOR,
    channel: HTTP.open({ url: serviceURL, method: 'POST', fetch }),
  })

  return {
    async allocateSpace(invocation) {
      if (!invocation.capabilities.length) return true
      // if info capability is derivable from the passed capability, then we'll
      // receive a response and know that the invocation issuer has verified
      // themselves with w3access.
      const info = Space.info.invoke({
        issuer,
        audience: serviceDID,
        // @ts-expect-error
        with: invocation.capabilities[0].with,
        proofs: [invocation],
      })

      const result = await info.execute(conn)

      if (result.error) {
        return result.error && result.name === 'SpaceUnknown'
          ? new Failure(`Space has no storage provider`, { cause: result })
          : result
      } else {
        return {}
      }
    },
  }
}
