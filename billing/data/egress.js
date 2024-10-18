import { Link } from '@ucanto/server'
import { DecodeFailure, EncodeFailure, Schema } from './lib.js'

export const egressSchema = Schema.struct({
    customer: Schema.did({ method: 'mailto' }),
    resource: Schema.link(),
    bytes: Schema.bigint(),
    servedAt: Schema.date(),
})

/** @type {import('../lib/api').Validator<import('../lib/api').EgressTrafficData>} */
export const validate = input => egressSchema.read(input)

/** @type {import('../lib/api').Encoder<import('../lib/api').EgressTrafficData, string>} */
export const encode = input => {
    try {
        return {
            ok: JSON.stringify({
                customer: input.customer.toString(),
                resource: input.resource.toString(),
                bytes: input.bytes.toString(),
                servedAt: input.servedAt.toISOString(),
            })
        }
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
                customer: Schema.did({ method: 'mailto' }).from(input.customer),
                resource: Link.parse(/** @type {string} */(input.resource)),
                bytes: BigInt(input.bytes),
                servedAt: new Date(input.servedAt),
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
