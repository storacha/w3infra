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
    const provider = parse(ids[getWeightedRandomInt(ids.map(id => id.weight ?? 0))].provider)
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
  selectReplicationProviders: async (primary, count, digest, size, options) => {
    const exclude = options?.exclude ?? []
    const providers = (await storageProviderTable.list())
      .filter(p => p.provider !== primary.did())
      .filter(p => !exclude.some(e => e.did() === p.provider))

    if (providers.length < count) {
      return error(new CandidateUnavailableError())
    }

    const selection = []
    for (let i = 0; i < count; i++) {
      const index = getWeightedRandomInt(providers.map(p => p.weight ?? 0))
      selection.push(parse(providers[index].provider))
      providers.splice(index, 1)
    }
    return ok(selection)
  }
})

/**
 * Generates a weighted random index based on the provided weights.
 * 
 * @param {number[]} weights - An array of weights.
 * @returns {number} - The index of the selected weight.
 */
const getWeightedRandomInt = (weights) => {
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0)
  let random = Math.random() * totalWeight

  for (let i = 0; i < weights.length; i++) {
    random -= weights[i]
    if (random <= 0) {
      return i
    }
  }
  throw new Error("did not find a weight - should never reach here")
}

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
