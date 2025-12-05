import { trace } from '@opentelemetry/api'
import * as API from '../types.js'
import * as Store from './agent/store.js'
import * as Stream from './agent/stream.js'
import { instrumentFn } from '../lib/otel/instrument.js'

export { API }

const tracer = trace.getTracer('upload-api')

/**
 * @typedef {object} Options
 * @property {Stream.Options} stream
 * @property {Store.Options} store
 *
 * @typedef {object} Connection
 * @property {Store.Store} store
 * @property {Stream.Stream} stream
 *
 *
 * @param {Options} options
 */
export const open = (options) =>
  new AgentMessageStore({
    store: Store.open(options.store),
    stream: Stream.open(options.stream),
  })

/**
 * @implements {API.AgentStore}
 */
class AgentMessageStore {
  /**
   * @param {Connection} connection
   */
  constructor(connection) {
    this.connection = connection
    this.invocations = new InvocationsIndex(connection.store)
    
    this.receipts = new ReceiptsIndex(connection.store)

    this.write = instrumentFn(tracer, 'AgentStore.write', this.write.bind(this))
  }

  get messages() {
    return this
  }

  /**
   * @param {API.ParsedAgentMessage} message
   * @returns {Promise<API.Result<API.Unit, API.WriteError>>}
   */
  async write({ data, index, source }) {
    const message = { data, source, index: [...index] }
    const save = Store.write(this.connection.store, message)
    const analyze = Stream.write(this.connection, message)

    const result = await save
    const { error } = result.error ? result : await analyze

    if (error) {
      return {
        error: new WriteError({
          cause: error,
          writer: this,
          payload: message,
        }),
      }
    }

    return { ok: {} }
  }
}

/**
 * @template T
 * @implements {API.WriteError<T>}
 */
export class WriteError extends Error {
  name = /** @type {const} */ ('WriteError')

  /** @type {API.Writer<T>} */
  #writer

  /**
   * @param {object} input
   * @param {Error} input.cause
   * @param {T} input.payload
   * @param {API.Writer<T>} input.writer
   */
  constructor({ cause, payload, writer }) {
    super(`Write to store has failed: ${cause}`)
    this.cause = cause
    this.payload = payload
    this.#writer = writer
  }

  // defined as getter so non-enumerable, and excluded from serialization by
  // ucanto when returned as the error from an invocation handler.
  get writer () {
    return this.#writer
  }
}

class InvocationsIndex {
  /**
   * @param {Store.Store} connection
   */
  constructor(connection) {
    this.connection = connection
    this.get = instrumentFn(tracer, 'AgentStore.invocations.get', this.get.bind(this))
  }

  /**
   * @param {API.UnknownLink} task
   */
  async get(task) {
    return Store.getInvocation(this.connection, task)
  }
}

/**
 * @implements {API.Accessor<API.UnknownLink, API.Receipt>}
 */
class ReceiptsIndex {
  /**
   * @param {Store.Store} connection
   */
  constructor(connection) {
    this.connection = connection
    this.get = instrumentFn(tracer, 'AgentStore.receipts.get', this.get.bind(this))
  }

  /**
   * @param {API.UnknownLink} task
   * @returns {Promise<API.Result<API.Receipt, API.StorageGetError>>}
   */
  get(task) {
    return Store.getReceipt(this.connection, task)
  }
}
