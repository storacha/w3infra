import * as Signer from '@ucanto/principal/ed25519'
import * as UcantoClient from '@ucanto/client'

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
