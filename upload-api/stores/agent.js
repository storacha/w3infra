import * as API from '../types.js'
import * as Store from './agent/store.js'
import * as Stream from './agent/stream.js'

export { API }

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
  }

  get messages() {
    return this
  }

  /**
   * @param {API.ParsedAgentMessage} message
   * @returns {Promise<API.Result<API.Unit, API.WriteError>>}
   */
  async write(message) {
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
class WriteError extends Error {
  name = /** @type {const} */ ('WriteError')
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
    this.writer = writer
  }
}

class InvocationsIndex {
  /**
   * @param {Store.Store} connection
   */
  constructor(connection) {
    this.connection = connection
  }

  /**
   * @param {API.UnknownLink} task
   */
  async get(task) {
    return Store.getInvocation(this.connection, task)
  }
}

class ReceiptsIndex {
  /**
   * @param {Store.Store} connection
   */
  constructor(connection) {
    this.connection = connection
  }

  /**
   * @param {API.UnknownLink} task
   */
  async get(task) {
    return Store.getReceipt(this.connection, task)
  }
}
