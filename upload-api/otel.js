import { context as otContext, propagation, trace, SpanStatusCode } from '@opentelemetry/api'
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node'
import {
  AlwaysOffSampler,
  AlwaysOnSampler,
  BatchSpanProcessor,
  ParentBasedSampler,
  TraceIdRatioBasedSampler,
} from '@opentelemetry/sdk-trace-base'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { Resource } from '@opentelemetry/resources'
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION
} from '@opentelemetry/semantic-conventions'
import {
  ATTR_DEPLOYMENT_ENVIRONMENT_NAME
} from '@opentelemetry/semantic-conventions/incubating'

const resource = new Resource({
  [ATTR_SERVICE_NAME]: 'upload-api',
  [ATTR_DEPLOYMENT_ENVIRONMENT_NAME]:
    process.env.SST_STAGE || process.env.NODE_ENV || 'development',
  [ATTR_SERVICE_VERSION]: process.env.VERSION || process.env.COMMIT,
})

const sampler = createSampler()
const endpoint = (process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4318').replace(/\/$/, '')
const exporter = new OTLPTraceExporter({
  url: `${endpoint}/v1/traces`,
  headers: parseHeaders(process.env.OTEL_EXPORTER_OTLP_HEADERS),
})

const provider = new NodeTracerProvider({ resource, sampler })
provider.addSpanProcessor(new BatchSpanProcessor(exporter))
provider.register()

const tracer = trace.getTracer('upload-api')

const headerGetter = {
  /** @param {Record<string, any>} carrier */
  keys: (carrier) => (carrier ? Object.keys(carrier) : []),
  /**
   * @param {Record<string, string|string[]>} carrier
   * @param {string} key
   */
  get: (carrier, key) => {
    if (!carrier) return []
    const needle = key.toLowerCase()
    return Object.entries(carrier)
      .filter(([k]) => k.toLowerCase() === needle)
      .flatMap(([, v]) => (Array.isArray(v) ? v : [v]))
      .filter(Boolean)
  },
}

/**
 * Wrap a Lambda handler with a root span.
 *
 * @template {(...args: any[]) => any} Fn
 * @param {string} name
 * @param {Fn} handler
 * @returns {Fn}
 */
export const wrapLambdaHandler = (name, handler) =>
  /** @type {Fn} */ (async (...args) => {
    const [event] = args
    // Pick up parent trace context from request headers when present.
    const carrier = event && typeof event === 'object' ? event.headers : undefined
    const parentCtx = propagation.extract(otContext.active(), carrier || {}, headerGetter)
    const span = tracer.startSpan(name, undefined, parentCtx)
    const ctxWithSpan = trace.setSpan(parentCtx, span)
    let response

    try {
      response = await otContext.with(ctxWithSpan, () => handler(...args))
    } catch (/** @type {any} */ err) {
      span.recordException(err)
      span.setStatus({ code: SpanStatusCode.ERROR, message: err?.message })
      throw err
    } finally {
      span.end()
    }

    // if the span is recording, then force flush, waiting for it to complete
    if (span.isRecording()) {
      try {
        await provider.forceFlush()
      } catch (err) {
        console.error('force flushing', err)
      }
    }

    return attachTraceContextToResponse(response, ctxWithSpan)
  })

/**
 * Add trace context headers to a Lambda response so callers can continue the trace.
 * 
 * @template T
 * @param {T} response
 * @param {import('@opentelemetry/api').Context} ctx
 * @returns {T}
 */
function attachTraceContextToResponse(response, ctx) {
  if (!response || typeof response !== 'object') return response

  /** @type {Record<string, string>} */
  const carrier = {}
  propagation.inject(ctx, carrier)

  // Merge headers without mutating original object references.
  return {
    ...response,
    headers: {
      ...(/** @type {any} */ (response)).headers,
      ...carrier,
    },
  }
}

function createSampler() {
  const samplerName = (process.env.OTEL_TRACES_SAMPLER || 'always_off').toLowerCase()
  const ratioArg = Number.parseFloat(process.env.OTEL_TRACES_SAMPLER_ARG || '1')
  const ratio = clamp(ratioArg, 0, 1)

  switch (samplerName) {
    case 'always_on':
      return new AlwaysOnSampler()
    case 'always_off':
      return new AlwaysOffSampler()
    case 'traceidratio':
      return new TraceIdRatioBasedSampler(ratio)
    case 'parentbased_always_on':
      return new ParentBasedSampler({ root: new AlwaysOnSampler() })
    case 'parentbased_always_off':
      return new ParentBasedSampler({ root: new AlwaysOffSampler() })
    case 'parentbased_traceidratio':
    default:
      return new ParentBasedSampler({ root: new TraceIdRatioBasedSampler(ratio) })
  }
}

/**
 * @param {string} [headerString]
 * @returns {Record<string, string>|undefined}
 */
function parseHeaders(headerString) {
  if (!headerString) return undefined
  return Object.fromEntries(
    headerString
      .split(',')
      .map((pair) => pair.trim())
      .filter(Boolean)
      .map((pair) => {
        const [key, ...rest] = pair.split('=')
        return [key.trim(), rest.join('=').trim()]
      })
      .filter(([key, value]) => key && value)
  )
}

/**
 * @param {number} value
 * @param {number} min
 * @param {number} max
 */
function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}
