import { DecodeFailure, EncodeFailure, InvalidInput, isDID } from './lib.js'

/** @type {import('../types').Validator<import('../types').SpaceSnapshot>} */
export const validate = input => {
  if (input == null || typeof input !== 'object') {
    return { error: new InvalidInput('not an object') }
  }
  if (!isDID(input.provider)) {
    return { error: new InvalidInput('not a DID', 'provider') }
  }
  if (!isDID(input.space)) {
    return { error: new InvalidInput('not a DID', 'space') }
  }
  if (typeof input.size !== 'number') {
    return { error: new InvalidInput('not a number', 'size') }
  }
  if (!(input.recordedAt instanceof Date)) {
    return { error: new InvalidInput('not a Date instance', 'recordedAt') }
  }
  if (!(input.insertedAt instanceof Date)) {
    return { error: new InvalidInput('not a Date instance', 'insertedAt') }
  }
  return { ok: {} }
}

/** @type {import('../types').Encoder<import('../types').SpaceSnapshot, Omit<import('../types').InferStoreRecord<import('../types').SpaceSnapshot>, 'provider'>>} */
export const encode = input => {
  try {
    return {
      ok: {
        space: `${input.space},${input.provider}`,
        size: input.size,
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

/**
 * @type {import('../types').Encoder<import('../types').SpaceSnapshotKey, Omit<import('../types').InferStoreRecord<import('../types').SpaceSnapshotKey>, 'provider'>>}
 */
export const encodeKey = input => ({
  ok: {
    space: `${input.space},${input.provider}`,
    recordedAt: input.recordedAt.toISOString()
  }
})

/**
 * @type {import('../types').Decoder<import('../types').StoreRecord, import('../types').SpaceSnapshot>}
 */
export const decode = input => {
  if (typeof input.space !== 'string') {
    return { error: new DecodeFailure(`"space" is not a string`) }
  }
  const [space, provider] = input.space.split(',')
  if (!isDID(space)) {
    return { error: new DecodeFailure(`"space" is not a DID`) }
  }
  if (!isDID(provider)) {
    return { error: new DecodeFailure(`"provider" is not a DID`) }
  }
  if (typeof input.size !== 'number') {
    return { error: new DecodeFailure(`"size" is not a number`) }
  }
  try {
    return {
      ok: {
        space,
        provider,
        size: input.size,
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
