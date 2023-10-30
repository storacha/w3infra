import * as Link from 'multiformats/link'
import { EncodeFailure, DecodeFailure, Schema } from './lib.js'

/**
 * @typedef {import('../lib/api').SpaceDiff} SpaceDiff
 * @typedef {import('../types').InferStoreRecord<SpaceDiff>} SpaceDiffStoreRecord
 * @typedef {import('../lib/api').SpaceDiffKey} SpaceDiffKey
 * @typedef {import('../types').InferStoreRecord<SpaceDiffKey>} SpaceDiffKeyStoreRecord
 * @typedef {import('../types').StoreRecord} StoreRecord
 */

export const schema = Schema.struct({
  customer: Schema.did({ method: 'mailto' }),
  space: Schema.did(),
  provider: Schema.did({ method: 'web' }),
  subscription: Schema.text(),
  cause: Schema.link({ version: 1 }),
  change: Schema.integer(),
  receiptAt: Schema.date(),
  insertedAt: Schema.date()
})

/** @type {import('../lib/api').Validator<SpaceDiff>} */
export const validate = input => schema.read(input)

/** @type {import('../lib/api').Encoder<SpaceDiff, SpaceDiffStoreRecord>} */
export const encode = input => {
  try {
    return {
      ok: {
        customer: input.customer,
        space: input.space,
        provider: input.provider,
        subscription: input.subscription,
        cause: input.cause.toString(),
        change: input.change,
        receiptAt: input.receiptAt.toISOString(),
        insertedAt: new Date().toISOString()
      }
    }
  } catch (/** @type {any} */ err) {
    return {
      error: new EncodeFailure(`encoding space diff record: ${err.message}`)
    }
  }
}

/** @type {import('../lib/api').Encoder<SpaceDiffKey, SpaceDiffKeyStoreRecord>} */
export const encodeKey = input => ({ ok: { customer: input.customer } })

/** @type {import('../lib/api').Decoder<StoreRecord, SpaceDiff>} */
export const decode = input => {
  try {
    return {
      ok: {
        customer: Schema.did({ method: 'mailto' }).from(input.customer),
        space: Schema.did().from(input.space),
        provider: Schema.did({ method: 'web' }).from(input.provider),
        subscription: String(input.subscription),
        cause: Link.parse(String(input.cause)),
        change: Number(input.change),
        receiptAt: new Date(input.receiptAt),
        insertedAt: new Date(input.insertedAt)
      }
    }
  } catch (/** @type {any} */ err) {
    return {
      error: new DecodeFailure(`decoding space diff record: ${err.message}`)
    }
  }
}
