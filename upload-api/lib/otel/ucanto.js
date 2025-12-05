import { SpanStatusCode } from '@opentelemetry/api'

/**
 * @import { Tracer } from '@opentelemetry/api'
 * @import { Capability, Failure, ServiceMethod } from '@ucanto/interface'
 */

/**
 * @template {Record<string, any>} S
 * @param {Tracer} tracer
 * @param {S} service
 * @returns {S}
 */
export const instrumentServiceMethods = (tracer, service) => {
  /** @type {Record<string, any>} */
  const instrumentedService = {}
  for (const [k, v] of Object.entries(service)) {
    if (typeof v === 'object') {
      instrumentedService[k] = instrumentServiceMethods(tracer, v)
    } else {
      instrumentedService[k] = instrumentServiceMethod(tracer, v)
    }
  }
  return /** @type {S} */ (instrumentedService)
}

/**
 * @template {Capability} I
 * @template {object} O
 * @template {Failure} X
 * @param {Tracer} tracer
 * @param {ServiceMethod<I, O, X>} method
 * @returns {ServiceMethod<I, O, X>}
 */
export const instrumentServiceMethod = (tracer, method) =>
  async (invocation, context) => {
    const ability = invocation.capabilities[0]?.can ?? 'unknown'
    return tracer.startActiveSpan(ability, async span => {
      try {
        const result = await method(invocation, context)
        if (result.error) {
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: result.error.message
          })
        }
        return result
      } finally {
        span.end()
      }
    })
  }
