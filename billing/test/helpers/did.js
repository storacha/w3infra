import { Signer } from '@ucanto/principal/ed25519'
import { randomInteger } from './math.js'
import { randomAlphas } from './ascii.js'

const tlds = ['com', 'org', 'net', 'io', 'storage']

const randomDomain = () =>
  `${randomAlphas(randomInteger(1, 32))}.${tlds[randomInteger(0, tlds.length)]}`

/** @returns {import("@ucanto/interface").DID<'mailto'>} */
export const randomDIDMailto = () =>
  `did:mailto:${randomDomain()}:${randomAlphas(randomInteger(1, 16))}`

/** @returns {Promise<import("@ucanto/interface").DID>} */
export const randomDID = () => randomDIDKey()

/** @returns {Promise<import("@ucanto/interface").DID<'key'>>} */
export const randomDIDKey = async () => {
  const signer = await Signer.generate()
  return signer.did()
}
