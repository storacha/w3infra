import { Link } from '@ucanto/server'
import { DecodeFailure, EncodeFailure, Schema } from './lib.js'

/**
 * @typedef { import('../types.js').InferStoreRecord<import('../lib/api.js').EgressTrafficData> } EgressTrafficStoreRecord
 * @typedef { import('../types.js').InferStoreRecord<import('../lib/api.js').EgressTrafficEventListKey> } EgressTrafficKeyStoreRecord
 */

export const egressSchema = Schema.struct({
  space: Schema.did({ method: 'key' }),
  customer: Schema.did({ method: 'mailto' }),
  resource: Schema.link(),
  bytes: Schema.number(),
  servedAt: Schema.date(),
  cause: Schema.link(),
})

/** @type {import('../lib/api.js').Validator<import('../lib/api.js').EgressTrafficData>} */
export const validate = input => egressSchema.read(input)

/** @type {import('../lib/api.js').Encoder<import('../lib/api.js').EgressTrafficData, EgressTrafficStoreRecord>} */
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

/** @type {import('../lib/api.js').Encoder<import('../lib/api.js').EgressTrafficData, string>} */
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

/** @type {import('../lib/api.js').Decoder<import('../types.js').StoreRecord, import('../lib/api.js').EgressTrafficData>} */
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

/** @type {import('../lib/api.js').Decoder<string, import('../lib/api.js').EgressTrafficData>} */
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
  /** @type {import('../lib/api.js').Encoder<import('../lib/api.js').EgressTrafficEventListKey, EgressTrafficKeyStoreRecord>} */
  encodeKey: input => ({
    ok: {
      space: input.space.toString(),
      customer: input.customer.toString(),
      from: input.from.toISOString()
    }
  }),
  /** @type {import('../lib/api.js').Decoder<EgressTrafficKeyStoreRecord, import('../lib/api.js').EgressTrafficEventListKey>} */
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