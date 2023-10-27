import { DecodeFailure, EncodeFailure, InvalidInput, isDID, isDIDWeb } from './lib.js'

/**
 * @typedef {import('../lib/api').SpaceSnapshot} SpaceSnapshot
 * @typedef {import('../types').InferStoreRecord<SpaceSnapshot> & { PK: string }} SpaceSnapshotStoreRecord
 * @typedef {import('../lib/api').SpaceSnapshotKey} SpaceSnapshotKey
 * @typedef {Omit<import('../types').InferStoreRecord<SpaceSnapshotKey>, 'provider'|'space'> & { PK: string }} SpaceSnapshotKeyStoreRecord
 * @typedef {import('../types').StoreRecord} StoreRecord
 */

/** @type {import('../lib/api').Validator<SpaceSnapshot>} */
export const validate = input => {
  if (input == null || typeof input !== 'object') {
    return { error: new InvalidInput('not an object') }
  }
  if (!isDIDWeb(input.provider)) {
    return { error: new InvalidInput('not a DID', 'provider') }
  }
  if (!isDID(input.space)) {
    return { error: new InvalidInput('not a DID', 'space') }
  }
  if (typeof input.size !== 'bigint') {
    return { error: new InvalidInput('not a bigint', 'size') }
  }
  if (!(input.recordedAt instanceof Date)) {
    return { error: new InvalidInput('not a Date instance', 'recordedAt') }
  }
  if (!(input.insertedAt instanceof Date)) {
    return { error: new InvalidInput('not a Date instance', 'insertedAt') }
  }
  return { ok: {} }
}

/** @type {import('../lib/api').Encoder<SpaceSnapshot, SpaceSnapshotStoreRecord>} */
export const encode = input => {
  try {
    return {
      ok: {
        PK: `${input.space}#${input.provider}`,
        space: input.space,
        provider: input.provider,
        size: input.size.toString(),
        recordedAt: input.recordedAt.toISOString(),
        insertedAt: input.insertedAt.toISOString()
      }
    }
  } catch (/** @type {any} */ err) {
    return {
      error: new EncodeFailure(`encoding space snapshot record: ${err.message}`)
    }
  }
}

/** @type {import('../lib/api').Encoder<SpaceSnapshotKey, SpaceSnapshotKeyStoreRecord>} */
export const encodeKey = input => ({
  ok: {
    PK: `${input.space}#${input.provider}`,
    recordedAt: input.recordedAt.toISOString()
  }
})

/** @type {import('../lib/api').Decoder<StoreRecord, SpaceSnapshot>} */
export const decode = input => {
  if (typeof input.space !== 'string') {
    return { error: new DecodeFailure(`"space" is not a string`) }
  }
  if (!isDID(input.space)) {
    return { error: new DecodeFailure(`"space" is not a DID`) }
  }
  if (!isDIDWeb(input.provider)) {
    return { error: new DecodeFailure(`"provider" is not a web DID`) }
  }
  try {
    return {
      ok: {
        space: input.space,
        provider: input.provider,
        size: BigInt(input.size),
        recordedAt: new Date(input.recordedAt),
        insertedAt: new Date(input.insertedAt)
      }
    }
  } catch (/** @type {any} */ err) {
    return {
      error: new DecodeFailure(`decoding space snapshot record: ${err.message}`)
    }
  }
}
