import * as Link from 'multiformats/link'
import { DecodeFailure, EncodeFailure, Schema } from './lib.js'

/**
 * @typedef {import('../lib/api').Consumer} Consumer
 * @typedef {import('../types').InferStoreRecord<Consumer>} ConsumerStoreRecord
 * @typedef {import('../types').StoreRecord} StoreRecord
 * @typedef {import('../lib/api').ConsumerKey} ConsumerKey
 * @typedef {import('../types').InferStoreRecord<ConsumerKey>} ConsumerKeyStoreRecord
 * @typedef {import('../lib/api').ConsumerListKey} ConsumerListKey
 * @typedef {import('../types').InferStoreRecord<ConsumerListKey>} ConsumerListKeyStoreRecord
 * @typedef {Pick<Consumer, 'consumer'|'provider'|'subscription'>} ConsumerList
 */

const schema = Schema.struct({
  consumer: Schema.did(),
  provider: Schema.did({ method: 'web' }),
  subscription: Schema.text(),
  cause: Schema.link({ version: 1 }),
  insertedAt: Schema.date(),
  updatedAt: Schema.date()
})

/** @type {import('../lib/api').Validator<Consumer>} */
export const validate = input => schema.read(input)

/** @type {import('../lib/api').Encoder<Consumer, ConsumerStoreRecord>} */
export const encode = input => {
  try {
    return {
      ok: {
        consumer: input.consumer,
        provider: input.provider,
        subscription: input.subscription,
        cause: input.cause.toString(),
        insertedAt: input.insertedAt.toISOString(),
        updatedAt: input.updatedAt.toISOString()
      }
    }
  } catch (/** @type {any} */ err) {
    return {
      error: new EncodeFailure(`encoding consumer record: ${err.message}`)
    }
  }
}

/** @type {import('../lib/api').Decoder<StoreRecord, Consumer>} */
export const decode = input => {
  try { 
    return {
      ok: {
        consumer: Schema.did().from(input.consumer),
        provider: Schema.did({ method: 'web' }).from(input.provider),
        subscription: String(input.subscription),
        cause: Link.parse(String(input.cause)),
        insertedAt: new Date(input.insertedAt),
        updatedAt: new Date(input.updatedAt)
      }
    }
  } catch (/** @type {any} */ err) {
    return {
      error: new DecodeFailure(`decoding consumer record: ${err.message}`)
    }
  }
}

/** @type {import('../lib/api').Encoder<ConsumerKey, ConsumerKeyStoreRecord>} */
export const encodeKey = input => ({
  ok: {
    subscription: input.subscription,
    provider: input.provider
  }
})

/** Encoders/decoders for listings. */
export const lister = {
  /** @type {import('../lib/api').Encoder<ConsumerListKey, ConsumerListKeyStoreRecord>} */
  encodeKey: input => ({ ok: { consumer: input.consumer } }),
  /** @type {import('../lib/api').Decoder<StoreRecord, ConsumerList>} */
  decode: input => {
    try { 
      return {
        ok: {
          consumer: Schema.did().from(input.consumer),
          provider: Schema.did({ method: 'web' }).from(input.provider),
          subscription: String(input.subscription)
        }
      }
    } catch (/** @type {any} */ err) {
      return {
        error: new DecodeFailure(`decoding consumer list record: ${err.message}`)
      }
    }
  }
}
