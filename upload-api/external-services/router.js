import { ok, error, Failure, Invocation } from '@ucanto/core'
import { parse } from '@ipld/dag-ucan/did'
import { CAR, HTTP } from '@ucanto/transport'
import { connect } from '@ucanto/client'

/**
 * @import * as API from '../types.js'
 * @import { BlobAPI } from '@storacha/upload-api/types'
 */

/**
 * @param {API.StorageProviderTable} storageProviderTable
 * @param {import('@ucanto/interface').Signer} serviceID
 * @returns {BlobAPI.RoutingService}
 */
export const create = (storageProviderTable, serviceID) => ({
  selectStorageProvider: async () => {
    const ids = await storageProviderTable.list()
    if (!ids.length) return error(new CandidateUnavailableError())
    const provider = parse(ids[getRandomInt(ids.length)])
    return ok(provider)
  },
  configureInvocation: async (provider, capability, options) => {
    const record = await storageProviderTable.get(provider.did())
    if (!record) {
      return error(new ProofUnavailableError(`provider not found: ${provider.did()}`))
    }
    const { endpoint, proof } = record

    const invocation = Invocation.invoke({
      ...options,
      issuer: serviceID,
      audience: provider,
      capability,
      proofs: [proof],
    })
    const channel = HTTP.open({ url: endpoint, method: 'POST' })
    const connection = connect({ id: provider, codec: CAR.outbound, channel })

    return ok({ invocation, connection })
  },
})

/** @param {number} max */
const getRandomInt = (max) => Math.floor(Math.random() * max)

export class ProofUnavailableError extends Failure {
  static name = /** @type {const} */ ('ProofUnavailable')

  get name() {
    return ProofUnavailableError.name
  }

  /** @param {string} [reason] */
  constructor(reason) {
    super()
    this.reason = reason
  }

  describe() {
    return this.reason ?? 'proof unavailable'
  }
}

export class CandidateUnavailableError extends Failure {
  static name = /** @type {const} */ ('CandidateUnavailable')

  get name() {
    return CandidateUnavailableError.name
  }

  /** @param {string} [reason] */
  constructor(reason) {
    super()
    this.reason = reason
  }

  describe() {
    return this.reason ?? 'no candidates available for blob allocation'
  }
}
