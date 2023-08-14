import * as ed25519 from '@ucanto/principal/ed25519'
import * as DID from '@ipld/dag-ucan/did'

/**
 * Given a config, return a ucanto Signer object representing the service
 *
 * @param {object} config
 * @param {string} config.PRIVATE_KEY - multiformats private key of primary signing key
 * @param {string} [config.UPLOAD_API_DID] - public DID for the upload service (did:key:... derived from PRIVATE_KEY if not set)
 * @returns {import('@ucanto/principal/ed25519').Signer.Signer}
 */
export function getServiceSigner(config) {
  const signer = ed25519.parse(config.PRIVATE_KEY)
  if (config.UPLOAD_API_DID) {
    const did = DID.parse(config.UPLOAD_API_DID).did()
    return signer.withDID(did)
  }
  return signer
}

/**
 * Given a string, parse into provider ServiceDIDs. 
 * 
 * @param {string} serviceDids a comma-separated string of ServiceDIDs
 * @returns {import('@web3-storage/upload-api').ServiceDID[]}
 */
export function parseServiceDids(serviceDids) {
  return /** @type {import('@web3-storage/upload-api').ServiceDID[]} */(
    serviceDids.split(',').map(s => {
      const did = DID.parse(s.trim()).did()
      if (!did.startsWith('did:web:')) {
        throw new Error(`Invalid ServiceDID - ServiceDID must be a did:web: ${did}`)
      }
      return did
    })
  )
}