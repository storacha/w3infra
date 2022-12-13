/**
 * This is an implementation of ucanto server based on @ucanto/server.
 * After iterating here, we should move into 
 */

// eslint-disable-next-line no-unused-vars
import * as API from '@ucanto/interface'
import { Verifier } from '@ucanto/principal'
import { execute } from '@ucanto/server'

import { persistUcanInvocation } from '../ucan-invocation.js'

/**
 * Creates a connection to a service.
 *
 * @template {Record<string, any>} Service
 * @param {API.Server<Service> & import('./types').UcantoServerContext} options
 * @returns {API.ServerView<Service>}
 */
export const create = options => new Server(options)

/**
 * @template {Record<string, any>} Service
 * @implements {API.ServerView<Service>}
 */
class Server {
  /**
   * @param {API.Server<Service> & import('./types').UcantoServerContext} options
   */
  constructor({
    id,
    service,
    encoder,
    decoder,
    principal = Verifier,
    ucanBucket,
    canIssue = (capability, issuer) =>
      capability.with === issuer || issuer === id.did(),
    ...rest
  }) {
    const { catch: fail, ...context } = rest
    this.context = { id, principal, canIssue, ...context }
    this.service = service
    this.encoder = encoder
    this.decoder = decoder
    this.ucanBucket = ucanBucket
    this.catch = fail || (() => {})
  }

  get id() {
    return this.context.id
  }

  /**
   * @template {API.Capability} C
   * @template {API.Tuple<API.ServiceInvocation<C, Service>>} I
   * @param {API.HTTPRequest<I>} request
   * @returns {API.Await<API.HTTPResponse<API.InferServiceInvocations<I, Service>>>}
   */
  request(request) {
    return handle(/** @type {API.ServerView<Service>} */ (this), request, this.ucanBucket)
  }
}

/**
 * @template {Record<string, any>} T
 * @template {API.Capability} C
 * @template {API.Tuple<API.ServiceInvocation<C, T>>} I
 * @param {API.ServerView<T>} server
 * @param {API.HTTPRequest<I>} request
 * @param {import('./types').UcanBucket} ucanBucket
 * @returns {Promise<API.HTTPResponse<API.InferServiceInvocations<I, T>>>}
 */
export const handle = async (server, request, ucanBucket) => {
  const invocations = await server.decoder.decode(request)
  const result = await execute(invocations, server)
  const response = server.encoder.encode(result)

  // persist successful invocation handled
  // @ts-expect-error AWS request types are different
  await persistUcanInvocation(request, ucanBucket)

  return response
}
