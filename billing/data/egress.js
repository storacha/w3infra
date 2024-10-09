import { DecodeFailure, EncodeFailure, Schema } from './lib.js'

/**
 * @typedef {import('../lib/api').EgressEvent} EgressEvent
 * @typedef {import('../types').InferStoreRecord<EgressEvent> & { pk: string, sk: string }} EgressEventStoreRecord
 * @typedef {import('../types').StoreRecord} StoreRecord
 * @typedef {import('../lib/api').EgressEventListKey} EgressEventListKey
 * @typedef {{ pk: string, sk: string }} EgressEventListStoreRecord
 */

export const egressSchema = Schema.struct({
    customerId: Schema.did({ method: 'mailto' }),
    resourceId: Schema.text(),
    timestamp: Schema.date(),
})

/** @type {import('../lib/api').Validator<EgressEvent>} */
export const validate = input => egressSchema.read(input)

/** @type {import('../lib/api').Encoder<EgressEvent, EgressEventStoreRecord>} */
export const encode = input => {
    try {
        return {
            ok: {
                pk: `${input.timestamp.toISOString()}#${input.customerId}`,
                sk: `${input.timestamp.toISOString()}#${input.customerId}#${input.resourceId}`,
                customerId: input.customerId,
                resourceId: input.resourceId,
                timestamp: input.timestamp.toISOString(),
            }
        }
    } catch (/** @type {any} */ err) {
        return {
            error: new EncodeFailure(`encoding egress event: ${err.message}`, { cause: err })
        }
    }
}

/** @type {import('../lib/api').Encoder<EgressEvent, string>} */
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

/** @type {import('../lib/api').Decoder<StoreRecord, EgressEvent>} */
export const decode = input => {
    try {
        return {
            ok: {
                customerId: Schema.did({ method: 'mailto' }).from(input.customerId),
                resourceId: /** @type {string} */ (input.resourceId),
                timestamp: new Date(input.timestamp),
            }
        }
    } catch (/** @type {any} */ err) {
        return {
            error: new DecodeFailure(`decoding egress event: ${err.message}`, { cause: err })
        }
    }
}

/** @type {import('../lib/api').Decoder<string, EgressEvent>} */
export const decodeStr = input => {
    const data = decode(JSON.parse(input))
    if (data.error) throw data.error
    return { ok: data.ok }
}

export const lister = {
    /** @type {import('../lib/api').Encoder<EgressEventListKey, EgressEventListStoreRecord>} */
    encodeKey: input => ({
        ok: {
            pk: `${input.from.toISOString()}#${input.customerId}`,
            sk: `${input.from.toISOString()}#${input.customerId}#${input.resourceId}`
        }
    })
}