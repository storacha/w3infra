import * as ucanto from '@ucanto/core'
import * as Signer from '@ucanto/principal/ed25519'
import * as UcantoClient from '@ucanto/client'
import * as CBOR from '@ucanto/transport/cbor'

/**
 * @param {import('@ucanto/interface').Principal} audience
 */
export async function createSpace (audience) {
  const space = await Signer.generate()
  const spaceDid = space.did()

  return {
    proof: await UcantoClient.delegate({
      issuer: space,
      audience,
      capabilities: [{ can: '*', with: spaceDid }],
    }),
    spaceDid,
  }
}

/**
 * @param {ucanto.UCAN.IPLDLink<unknown, number, number, 0 | 1>} invocationCid
 * @param {any} out
 * @param {Signer.EdSigner} signer
 */
export async function createReceipt (invocationCid, out, signer) {
  const receiptPayload = {
    ran: invocationCid,
    out,
    fx: { fork: [] },
    meta: {},
    iss: signer.did(),
    prf: [],
  }

  return {
    ...receiptPayload,
    s: await signer.sign(CBOR.codec.encode(receiptPayload))
  }
}

/**
 * @param {import('@ucanto/interface').Ability} can
 * @param {any} nb
 * @param {object} [options]
 * @param {Signer.EdSigner} [options.audience]
 * @param {Signer.EdSigner} [options.issuer]
 * @param {`did:key:${string}`} [options.withDid]
 * @param {Signer.Delegation[]} [options.proofs]
 */
export async function createUcanInvocation (can, nb, options = {}) {
  const audience = options.audience || await Signer.generate()
  const issuer = options.issuer || await Signer.generate()

  let proofs
  let withDid
  if (!options.withDid || !options.proofs) {
    const { proof, spaceDid } = await createSpace(issuer)

    proofs = [proof]
    withDid = spaceDid
  } else {
    proofs = options.proofs
    withDid = options.withDid
  }
  
  return await ucanto.delegate({
    issuer,
    audience,
    capabilities: [
      {
        can,
        with: withDid,
        nb,
      },
    ],
    proofs,
  })
}
