import { invoke, delegate, Receipt, CBOR, CAR, API } from '@ucanto/core'
import * as Signer from '@ucanto/principal/ed25519'
import * as UcantoClient from '@ucanto/client'

/**
 * @param {API.Principal} audience
 */
export async function createSpace(audience) {
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
 * @param {API.UCAN.IPLDLink<unknown, number, number, 0 | 1>} invocationCid
 * @param {any} out
 * @param {Signer.EdSigner} signer
 */
export async function createReceipt(invocationCid, out, signer) {
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
    s: await signer.sign(CBOR.encode(receiptPayload)),
  }
}

/**
 * @param {API.Ability} can
 * @param {any} nb
 * @param {object} [options]
 * @param {Signer.EdSigner} [options.audience]
 * @param {Signer.EdSigner} [options.issuer]
 * @param {`did:key:${string}`} [options.withDid]
 * @param {Signer.Delegation[]} [options.proofs]
 */
export async function createUcanInvocation(can, nb, options = {}) {
  const audience = options.audience || (await Signer.generate())
  const issuer = options.issuer || (await Signer.generate())

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

  return await delegate({
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

/**
 * Create an invocation with given capabilities.
 *
 * @param {API.Ability} can
 * @param {any} nb
 * @param {object} [options]
 * @param {Signer.EdSigner} [options.audience]
 * @param {Signer.EdSigner} [options.issuer]
 * @param {`did:key:${string}`} [options.withDid]
 * @param {Signer.Delegation[]} [options.proofs]
 */
export async function createInvocation(can, nb, options = {}) {
  const audience = options.audience || (await Signer.generate())
  const issuer = options.issuer || (await Signer.generate())

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

  const invocation = invoke({
    issuer,
    audience,
    capability: {
      can,
      with: withDid,
      nb,
    },
    proofs,
  })

  return invocation
}

/**
 * @param {API.IssuedInvocation} run
 * @param {object} options
 * @param {any} [options.result]
 * @param {any} [options.meta]
 */
export async function createAgentMessageReceipt(
  run,
  { result = { ok: {} }, meta = { test: 'metadata' } }
) {
  const delegation = await run.buildIPLDView()

  return await Receipt.issue({
    // @ts-ignore Mismatch between types for Principal and Signer
    issuer: run.audience,
    result,
    ran: delegation.link(),
    meta,
    fx: {
      fork: [],
    },
  })
}

/**
 * Creates a request in the legacy format.
 * @see https://github.com/web3-storage/ucanto/blob/5341416a5f1ba5048c41476bb6c6059556e8e27b/packages/transport/src/car/request.js
 *
 * @param {API.IssuedInvocation[]} invocations
 */
export const createLegacyRequest = async (invocations) => {
  const roots = []
  const blocks = new Map()
  for (const invocation of invocations) {
    const dag = await invocation.buildIPLDView()
    roots.push(dag.root)
    for (const block of dag.iterateIPLDBlocks()) {
      blocks.set(block.cid.toString(), block)
    }
  }

  return {
    headers: { 'content-type': 'application/car' },
    /** @type {Uint8Array} */
    body: CAR.encode({ roots, blocks }),
  }
}
