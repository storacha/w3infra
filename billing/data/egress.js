import { Link } from '@ucanto/server'
import { DecodeFailure, EncodeFailure, Schema } from './lib.js'

/**
 * @typedef { import('../types').InferStoreRecord<import('../lib/api').EgressTrafficData> } EgressTrafficStoreRecord
 * @typedef { import('../types').InferStoreRecord<import('../lib/api').EgressTrafficEventListKey> } EgressTrafficKeyStoreRecord
 */

export const egressSchema = Schema.struct({
  space: Schema.did({ method: 'key' }),
  customer: Schema.did({ method: 'mailto' }),
  resource: Schema.link(),
  bytes: Schema.number(),
  servedAt: Schema.date(),
  cause: Schema.link(),
})

/** @type {import('../lib/api').Validator<import('../lib/api').EgressTrafficData>} */
export const validate = input => egressSchema.read(input)

/** @type {import('../lib/api').Encoder<import('../lib/api').EgressTrafficData, EgressTrafficStoreRecord>} */
export const encode = input => {
  try {
    return {
      ok: {
        space: input.space.toString(),
        customer: input.customer.toString(),
        resource: input.resource.toString(),
        bytes: Number(input.bytes),
        servedAt: input.servedAt.toISOString(),
        cause: input.cause.toString(),
      }
    }
  } catch (/** @type {any} */ err) {
    return {
      error: new EncodeFailure(`encoding string egress event: ${err.message}`, { cause: err })
    }
  }
}

/** @type {import('../lib/api').Encoder<import('../lib/api').EgressTrafficData, string>} */
export const encodeStr = input => {
  try {
    const data = encode(input)
    if (data.error) throw data.error
    return { ok: JSON.stringify(data.ok) }
  } catch (/** @type {any} */ err) {
    return {
      error: new EncodeFailure(`encoding string egress event: ${err.message}`, { cause: err })
    }
  }
}

/** @type {import('../lib/api').Decoder<import('../types.js').StoreRecord, import('../lib/api').EgressTrafficData>} */
export const decode = input => {
  try {
    return {
      ok: {
        space: Schema.did({ method: 'key' }).from(input.space),
        customer: Schema.did({ method: 'mailto' }).from(input.customer),
        resource: Link.parse(/** @type {string} */(input.resource)),
        bytes: Number(input.bytes),
        servedAt: new Date(input.servedAt),
        cause: Link.parse(/** @type {string} */(input.cause)),
      }
    }
  } catch (/** @type {any} */ err) {
    return {
      error: new DecodeFailure(`decoding egress event: ${err.message}`, { cause: err })
    }
  }
}

/** @type {import('../lib/api').Decoder<string, import('../lib/api').EgressTrafficData>} */
export const decodeStr = input => {
  try {
    return decode(JSON.parse(input))
  } catch (/** @type {any} */ err) {
    return {
      error: new DecodeFailure(`decoding str egress traffic event: ${err.message}`, { cause: err })
    }
  }
}

export const lister = {
  /** @type {import('../lib/api').Encoder<import('../lib/api').EgressTrafficEventListKey, EgressTrafficKeyStoreRecord>} */
  encodeKey: input => ({
    ok: {
      space: input.space.toString(),
      customer: input.customer.toString(),
      from: input.from.toISOString()
    }
  }),
  /** @type {import('../lib/api').Decoder<EgressTrafficKeyStoreRecord, import('../lib/api').EgressTrafficEventListKey>} */
  decodeKey: input => {
    try {
      return {
        ok: {
          space: Schema.did({ method: 'key' }).from(input.space),
          customer: Schema.did({ method: 'mailto' }).from(input.customer),
          from: new Date(input.from)
        }
      }
    } catch (/** @type {any} */ err) {
      return {
        error: new DecodeFailure(`decoding egress traffic event list key: ${err.message}`, { cause: err })
      }
    }
  }
}