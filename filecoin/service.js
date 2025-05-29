import * as ed25519 from '@ucanto/principal/ed25519'
import * as DID from '@ipld/dag-ucan/did'
import { CAR, HTTP } from '@ucanto/transport'
import { connect } from '@ucanto/client'

/**
 * Given a config, return a ucanto Signer object representing the service
 *
 * @param {object} config
 * @param {string} config.privateKey - multiformats private key of primary signing key
 * @returns {import('@ucanto/principal/ed25519').Signer.Signer}
 */
export function getServiceSigner(config) {
  return ed25519.parse(config.privateKey)
}

/**
 * @param {{ did: string, url: string|URL }} config
 */
export function getServiceConnection (config) {
  const servicePrincipal = DID.parse(config.did) // 'did:web:filecoin.web3.storage'
  const serviceURL = new URL(config.url) // 'https://filecoin.web3.storage'

  const serviceConnection = connect({
    id: servicePrincipal,
    codec: CAR.outbound,
    channel: HTTP.open({
      url: serviceURL,
      method: 'POST',
    }),
  })

  return serviceConnection
}
