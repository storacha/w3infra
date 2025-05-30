import * as ed25519 from '@ucanto/principal/ed25519'
import * as DID from '@ipld/dag-ucan/did'
import { CAR, HTTP } from '@ucanto/transport'
import { connect } from '@ucanto/client'

/**
 * Given a config, return a Ucanto Signer object representing the service.
 *
 * @param {object} config
 * @param {string} config.privateKey - multibase encoded Ed25519 private key
 * @param {string} [config.did] - public DID for the service (a did:web: DID)
 * @returns {import('@ucanto/principal/ed25519').Signer.Signer}
 */
export function getServiceSigner(config) {
  const signer = ed25519.parse(config.privateKey)
  if (config.did) {
    const did = DID.parse(config.did).did()
    return signer.withDID(did)
  }
  return signer
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
