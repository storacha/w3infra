import { DecodeFailure, EncodeFailure, Schema } from './lib.js'

/**
 * @typedef {import('../lib/api.js').EgressTrafficMonthlySummary} EgressTrafficMonthlySummary
 * @typedef {import('../lib/api.js').EgressTrafficMonthlySummaryStoreRecord} EgressTrafficMonthlySummaryStoreRecord
 */

/** Individual field schemas for partial validation */
const fieldSchemas = {
  customer: Schema.did({ method: 'mailto' }),
  space: Schema.did({ method: 'key' }),
  bytes: Schema.number(),
  eventCount: Schema.number(),
  month: Schema.string().refine({
    read: (input) =>
      /^\d{4}-\d{2}$/.test(input)
        ? { ok: input }
        : Schema.error(`Expected YYYY-MM format, got "${input}"`)
  })
}

/** Full schema for complete record validation */
export const egressMonthlySchema = Schema.struct(fieldSchemas)

/**
 * Validate egress monthly summary data
 * @template T
 * @param {T} input - Data to validate
 * @param {Array<'customer'|'space'|'bytes'|'eventCount'|'month'>} [fields] - Optional array of field names to validate. If not provided, validates entire struct.
 * @returns {import('@ucanto/interface').Result<T, import('@ucanto/interface').Failure>}
 * @example
 * // Validate entire struct
 * validate({ customer: 'did:mailto:...', space: 'did:key:...', ... })
 *
 * // Validate only specific fields
 * validate({ month: '2024-01', customer: 'did:mailto:...' }, ['month', 'customer'])
 */

/**                                                                                                                                                                                                                          
 * @overload                                                                                                                                                                                                                 
 * @param {unknown} input                                                                                                                                                                                                    
 * @returns {import('@ucanto/interface').Result<import('../lib/api.js').EgressTrafficMonthlySummary, import('@ucanto/interface').Failure>}                                                                                   
 *                                                                                                                                                                                                                      
 * @overload                                                                                                                                                                                                                 
 * @param {unknown} input                                                                                                                                                                                                    
 * @param {Array<'customer'|'space'|'bytes'|'eventCount'|'month'>} fields                                                                                                                                                    
 * @returns {import('@ucanto/interface').Result<Partial<import('../lib/api.js').EgressTrafficMonthlySummary>, import('@ucanto/interface').Failure>}                                                                          
 *                                                                                                                                                                                                                          
 * @param {unknown} input                                                                                                                                                                                                    
 * @param {Array<'customer'|'space'|'bytes'|'eventCount'|'month'>} [fields]                                                                                                                                                  
 */       
export const validate = (input, fields) => {
  if (!fields) {
    // Validate entire struct
    return egressMonthlySchema.read(input)
  }

  // Build partial schema with only specified fields
  /** @type {Record<string, any>} */
  const partialSchemaFields = {}
  for (const field of fields) {
    if (fieldSchemas[field]) {
      partialSchemaFields[field] = fieldSchemas[field]
    }
  }

  const partialSchema = Schema.struct(partialSchemaFields)
  return partialSchema.read(input)
}

/**
 * Encode monthly summary for DynamoDB storage
 * @type {import('../lib/api.js').Encoder<EgressTrafficMonthlySummary, EgressTrafficMonthlySummaryStoreRecord>}
 */
export const encode = input => {
  try {
    return {
      ok: {
        pk: `customer#${input.customer.toString()}`,
        sk: `${input.month}#${input.space.toString()}`,
        space: input.space.toString(),
        month: input.month,
        bytes: Number(input.bytes),
        eventCount: Number(input.eventCount)
      }
    }
  } catch (/** @type {any} */ err) {
    return {
      error: new EncodeFailure(`encoding egress monthly summary: ${err.message}`, { cause: err })
    }
  }
}

/**
 * Decode monthly summary from DynamoDB
 * @type {import('../lib/api.js').Decoder<EgressTrafficMonthlySummaryStoreRecord, EgressTrafficMonthlySummary>}
 */
export const decode = input => {
  try {
    const [, customer] = input.pk.split('#')
    const [month, space] = input.sk.split('#')

    return {
      ok: {
        customer: Schema.did({ method: 'mailto' }).from(customer),
        space: Schema.did({ method: 'key' }).from(space),
        month,
        bytes: input.bytes,
        eventCount: input.eventCount
      }
    }
  } catch (/** @type {any} */ err) {
    return {
      error: new DecodeFailure(`decoding egress monthly summary: ${err.message}`, { cause: err })
    }
  }
}

/**
 * Extract month in YYYY-MM format from a Date
 * @param {Date} date
 * @returns {string} YYYY-MM format
 */
export const extractMonth = date => {
  return date.toISOString().slice(0, 7)
}