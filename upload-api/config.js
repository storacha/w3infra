/**
 * This file uses SSTs magic Config handler.
 * If you depend on it in a test then you need to use the `sst bind` CLI to setup the config object.
 *
 * see: https://docs.sst.dev/config
 * see: https://docs.sst.dev/advanced/testing#how-sst-bind-works
 */
import * as ed25519 from '@ucanto/principal/ed25519'
import * as DID from '@ipld/dag-ucan/did'

/**
 * Given a config, return a ucanto Signer object representing the service
 *
 * @param {object} config
 * @param {string} config.PRIVATE_KEY - multiformats private key of primary signing key
 */
 export function getServiceSigner(config) {
  const signer = ed25519.parse(config.PRIVATE_KEY)
  return signer
}

/**
 * Given a config, return a ucanto principal
 *
 * @param {{ UPLOAD_API_DID: string } | { PRIVATE_KEY: string }} config
 * @returns {import('@ucanto/interface').Principal}
 */
export function getServerPrincipal(config) {
  if ('UPLOAD_API_DID' in config) {
    return DID.parse(config.UPLOAD_API_DID)
  }
  return getServiceSigner(config)
}
