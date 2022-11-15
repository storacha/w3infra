import { info } from '@web3-storage/access/capabilities/account'
import { connect } from '@ucanto/client'
import { CAR, CBOR, HTTP } from '@ucanto/transport'

/**
 * @param {import('@ucanto/interface').Signer} issuer
 * @param {import('@ucanto/interface').Principal} serviceDID
 * @param {URL} serviceURL
 * @returns {import('./service/types').AccessClient}
 */
export function createAccess (issuer, serviceDID, serviceURL) {
  const conn = connect({
    id: serviceDID,
    encoder: CAR,
    decoder: CBOR,
    channel: HTTP.open({
      url: new URL(serviceURL),
      method: 'POST'
    })
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
