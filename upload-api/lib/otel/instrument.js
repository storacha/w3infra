import { SpanStatusCode } from '@opentelemetry/api'

/** @import { Tracer } from '@opentelemetry/api' */

/**
 * @template {Function} F
 * @param {Tracer} tracer OpenTelemetry tracer to use.
 * @param {string} name Name of the function.
 * @param {F} fn Function to instrument.
 * @returns {(...args: Parameters<F>) => ReturnType<F>}
 */
export const instrumentFn = (tracer, name, fn) =>
  (...args) =>
    tracer.startActiveSpan(name, span => {
      let ret
      try {
        ret = fn(...args)
      } catch (/** @type {any} */ err) {
        span.recordException(err)
        span.setStatus({ code: SpanStatusCode.ERROR, message: err?.message })
        span.end()
        throw err
      }
      if (ret && typeof ret.then == 'function') {
        return Promise.resolve(ret)
          .catch(err => {
            span.recordException(err)
            span.setStatus({ code: SpanStatusCode.ERROR, message: err?.message })
            throw err
          })
          .finally(() => span.end())
      }
      span.end()
      return ret
    })

/**
 * @template {Record<string, any>} T
 * @param {Tracer} tracer
 * @param {string} name
 * @param {T} obj
 * @param {string[]} [methods]
 * @returns {T}
 */
export const instrumentMethods = (tracer, name, obj, methods) => {
  // /** @type {Record<string, any>} */
  // const instObj = { ...obj }
  // for (const method of methods ?? Object.keys(obj)) {
  //   const fn = obj[method]
  //   if (typeof fn === 'function') {
  //     instObj[method] = instrumentFn(tracer, `${name}.${method}`, fn.bind(obj))
  //   }
  // }
  // return /** @type {T} */ (instObj)
  return obj
}
