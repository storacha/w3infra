import { trace } from '@opentelemetry/api'
import { instrumentMethods } from '../lib/otel/instrument.js'

const tracer = trace.getTracer('upload-api')

/**
 * Abstraction layer for referrals.
 *
 * @param {object} [options]
 * @param {string} [options.endpoint]
 * @returns {import('../types.js').ReferralsStore}
 */
export function createReferralStore(options = {}) {
  return instrumentMethods(tracer, 'ReferralsStorage', {
    async getReferredBy(email) {
      const result = await fetch(`${options.endpoint}/referredby/${email}`)
      return await result.json()
    }
  })
}
