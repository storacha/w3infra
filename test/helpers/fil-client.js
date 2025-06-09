import * as Signer from '@ucanto/principal/ed25519'
import * as DID from '@ipld/dag-ucan/did'
import { CAR, HTTP } from '@ucanto/transport'
import { connect } from '@ucanto/client'
import { getApiEndpoint } from './deployment.js'
import { mustGetEnv } from '../../lib/env.js'

export const storefrontServiceURL = new URL(getApiEndpoint())
export const storefrontServicePrincipal = DID.parse(mustGetEnv('UPLOAD_API_DID'))

/**
 * Client connection config for w3filecoin pipeline entrypoint, i.e. API Storefront relies on
 *
 * @param {URL} url 
 */
export async function getClientConfig (url) {
  // UCAN actors
  const agent = await Signer.generate()

  return {
    invocationConfig: {
      issuer: agent,
      with: agent.did(),
      audience: storefrontServicePrincipal,
    },
    connection: connect({
      id: storefrontServicePrincipal,
      codec: CAR.outbound,
      channel: HTTP.open({
        url,
        method: 'POST',
      }),
    })
  }
}
