import { DecodeFailure, EncodeFailure, Schema } from './lib.js'

/**
 * @typedef {import('../lib/api').Usage} Usage
 * @typedef {import('../types').InferStoreRecord<Usage> & { sk: string }} UsageStoreRecord
 * @typedef {import('../lib/api').UsageListKey} UsageListKey
 * @typedef {Omit<import('../types').InferStoreRecord<UsageListKey>, 'from'> & { sk: string }} UsageListKeyStoreRecord
 * @typedef {import('../types').StoreRecord} StoreRecord
 */

export const schema = Schema.struct({
  customer: Schema.did({ method: 'mailto' }),
  space: Schema.did(),
  provider: Schema.did({ method: 'web' }),
  account: Schema.text(),
  product: Schema.text(),
  usage: Schema.bigint().greaterThanEqualTo(0n),
  from: Schema.date(),
  to: Schema.date(),
  insertedAt: Schema.date()
})

/** @type {import('../lib/api').Validator<Usage>} */
export const validate = input => schema.read(input)

/** @type {import('../lib/api').Encoder<Usage, UsageStoreRecord>} */
export const encode = input => {
  try {
    return {
      ok: {
        sk: `${input.from.toISOString()}#${input.provider}#${input.space}`,
        customer: input.customer,
        account: input.account,
        product: input.product,
        provider: input.provider,
        space: input.space,
        usage: input.usage.toString(),
        from: input.from.toISOString(),
        to: input.to.toISOString(),
        insertedAt: input.insertedAt.toISOString()
      }
    }
  } catch (/** @type {any} */ err) {
    return {
      error: new EncodeFailure(`encoding usage record: ${err.message}`)
    }
  }
}

export const lister = {
  /** @type {import('../lib/api').Encoder<UsageListKey, UsageListKeyStoreRecord>} */
  encodeKey: input => ({
    ok: {
      customer: input.customer,
      sk: input.from.toISOString()
    }
  })
}



/** @type {import('../lib/api').Decoder<StoreRecord, Usage>} */
export const decode = input => {
  try {
    return {
      ok: {
        customer: Schema.did({ method: 'mailto' }).from(input.customer),
        account: String(input.account),
        product: String(input.product),
        provider: Schema.did({ method: 'web' }).from(input.provider),
        space: Schema.did().from(input.space),
        usage: BigInt(input.usage),
        from: new Date(input.from),
        to: new Date(input.to),
        insertedAt: new Date(input.insertedAt)
      }
    }
  } catch (/** @type {any} */ err) {
    return {
      error: new DecodeFailure(`decoding usage record: ${err.message}`)
    }
  }
}
