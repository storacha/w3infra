import { info } from '@web3-storage/access/capabilities/account'
import { connect } from '@ucanto/client'
import { CAR, CBOR, HTTP } from '@ucanto/transport'
import fetch from '@web-std/fetch'

/**
 * @param {import('@ucanto/interface').Signer} issuer Issuer of UCAN invocations to the Access service.
 * @param {import('@ucanto/interface').Principal} serviceDID DID of the Access service.
 * @param {URL} serviceURL URL of the Access service.
 * @returns {import('./service/types').AccessClient}
 */
export function createAccessClient (issuer, serviceDID, serviceURL) {
  /** @type {import('@ucanto/server').ConnectionView<import('@web3-storage/access/types').Service>} */
  const conn = connect({
    id: serviceDID,
    encoder: CAR,
    decoder: CBOR,
    channel: HTTP.open({ url: serviceURL, method: 'POST', fetch })
  })

  return {
    async verifyInvocation (invocation) {
      if (!invocation.capabilities.length) return true
      // if info capability is derivable from the passed capability, then we'll
      // receive a response and know that the invocation issuer has verified
      // themselves with w3access.
      const res = await info
        .invoke({
          issuer,
          audience: serviceDID,
          // @ts-expect-error
          with: invocation.capabilities[0].with,
          proofs: [invocation]
        })
        .execute(conn)
      return !res.error
    }
  }
}
