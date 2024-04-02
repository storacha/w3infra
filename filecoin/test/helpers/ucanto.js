import * as Signer from '@ucanto/principal/ed25519'
import * as UcantoClient from '@ucanto/client'
import { Message } from '@ucanto/core'
import * as CAR from '@ucanto/transport/car'

/**
 * @typedef {import('@ucanto/interface').IssuedInvocation} IssuedInvocation
 * @typedef {import('@ucanto/interface').Receipt} Receipt
 * @typedef {import('@ucanto/interface').Tuple<Receipt>} TupleReceipt
 * @typedef {import('@ucanto/interface').Tuple<IssuedInvocation>} TupleIssuedInvocation
 */

/**
 * @param {object} source
 * @param {IssuedInvocation[]} [source.invocations]
 * @param {Receipt[]} [source.receipts]
 */
export const encodeAgentMessage = async (source) => {
  const message = await Message.build({
    invocations: /** @type {TupleIssuedInvocation} */ (
      source.invocations
    ),
    receipts: /** @type {TupleReceipt} */ (source.receipts),
  })

  return CAR.request.encode(message)
}

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
      capabilities: [{ can: '*', with: spaceDid }]
    }),
    spaceDid
  }
}
