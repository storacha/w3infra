import { Schema, DIDResolutionError } from '@ucanto/validator'
import { ok, error, fail } from '@ucanto/core'
import { parseDidPlc } from '@storacha/did-plc'
import { base58btc } from 'multiformats/bases/base58'
import { varint } from 'multiformats'
import * as ed25519 from '@ucanto/principal/ed25519'


/**
 * @typedef {Record<`did:web:${string}`, `did:key:${string}`>} PrincipalMapping
 */

/**
 * @typedef {import('@ucanto/interface').Signature} Signature
 */

/**
 * Creates a DID resolver that can resolve Web and PLC DIDs to their corresponding DID keys.
 *
 * @param {object} options
 * @param {PrincipalMapping} options.principalMapping - Mapping of known WebDIDs to their corresponding DIDKeys
 * @param {import('@storacha/did-plc').PlcClient} options.plcClient - PLC client to use for resolving PLC DIDs
 * @returns {(did: `did:${string}:${string}`) => Promise<import('@ucanto/interface').Result<`did:key:${string}`[], DIDResolutionError>>}
 */
export function createDidResolver(options) {
  /**
   * @param {`did:${string}:${string}`} did
   */
  return async (did) => {
    if (Schema.did({ method: 'web' }).is(did) && options.principalMapping) {
      return resolveDIDWeb(did, options.principalMapping)
    }

    if (Schema.did({ method: 'plc' }).is(did) && options.plcClient) {
      return resolveDIDPlc(did, options.plcClient)
    }

    return error(new DIDResolutionError(did))
  }
}

/**
 * Resolves a Web DID to its corresponding DID key.
 * 
 * @param {`did:web:${string}`} did
 * @param {PrincipalMapping} principalMapping
 * @returns {Promise<import('@ucanto/interface').Result<`did:key:${string}`[], DIDResolutionError>>}
 */
const resolveDIDWeb = async (did, principalMapping) => {
  if (principalMapping[did]) {
    return ok([/** @type {`did:key:${string}`} */(principalMapping[did])])
  }
  return error(new DIDResolutionError(did))
}

/**
 * Fetches the DID PLC Document and verifies the delegation signature against 
 * the verification methods available in the document.
 * 
 * @param {`did:${string}:${string}`} did
 * @param {import('@storacha/did-plc').PlcClient} plcClient
 * @returns {Promise<import('@ucanto/interface').Result<`did:key:${string}`[], DIDResolutionError>>}
 */
const resolveDIDPlc = async (did, plcClient) => {
  try {
    const doc = await plcClient.getDocument(parseDidPlc(did))

    // The verificationMethod array contains a list of public keys that can be used to verify proofs.
    // These methods MUST be of type: Multikey and MUST include a publicKeyMultibase.
    // Source: https://web.plc.directory/spec/v0.1/did-plc#did-document
    const verificationMethods = doc.verificationMethod || []
    const verifiers = verificationMethods
      .map(vm => parseMultikeyVerifier(vm.publicKeyMultibase))
      .filter(v => v !== null)
      .map(v => v.toDIDKey())

    return ok(verifiers)
  } catch (err) {
    console.error(`error resolving DID PLC key ${did}`, err)
    // @ts-expect-error - err can be any type of error
    return error(new DIDResolutionError(did, fail(err.toString()).error))
  }
}


/**
 * Parses a public key multibase string into a ed25519 Verifier.
 * 
 * @param {string} publicKeyMultibase
 */
function parseMultikeyVerifier(publicKeyMultibase) {
  try {
    const bytes = base58btc.decode(publicKeyMultibase) // assumes 'z'-prefix
    const [code] = varint.decode(bytes)
    switch (code) {
      case 0xed: { // Ed25519
        return ed25519.Verifier.parse(publicKeyMultibase)
      }
      default: {
        console.warn(`unsupported public key type: 0x${code.toString(16)} in ${publicKeyMultibase}`)
        return null
      }
    }
  } catch (err) {
    console.error(`unable to parse public key from verification method ${publicKeyMultibase}`, err)
    return null
  }
}