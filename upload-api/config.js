/**
 * This file uses SSTs magic Config handler.
 * If you depend on it in a test then you need to use the `sst bind` CLI to setup the config object.
 *
 * see: https://docs.sst.dev/config
 * see: https://docs.sst.dev/advanced/testing#how-sst-bind-works
 */
import * as ed25519 from '@ucanto/principal/ed25519'
import { DID } from '@ucanto/validator'

/**
 * Given a config, return a ucanto Signer object representing the service
 *
 * @param {object} config
 * @param {string} [config.UPLOAD_API_DID] - public identifier of the running service. e.g. a did:key or a did:web
 * @param {string} config.PRIVATE_KEY - multiformats private key of primary signing key
 */
 export function getServiceSigner(config) {
  const signer = ed25519.parse(config.PRIVATE_KEY)
  const did = config.UPLOAD_API_DID
  if (!did) {
    return signer
  }
  return signer.withDID(DID.match({}).from(did))
}
