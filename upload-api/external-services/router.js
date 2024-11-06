import { GetItemCommand, ScanCommand } from '@aws-sdk/client-dynamodb'
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb'
import { ok, error, Failure, Invocation } from '@ucanto/core'
import * as Link from 'multiformats/link'
import { base64 } from 'multiformats/bases/base64'
import { getDynamoClient } from '../../lib/aws/dynamo.js'
import { parse } from '@ipld/dag-ucan/did'
import { extract } from '@ucanto/core/delegation'
import { CAR, HTTP } from '@ucanto/transport'
import { connect } from '@ucanto/client'

/** @import { BlobAPI } from '@storacha/upload-api/types' */

/** 
 * @typedef {{
 *   provider: import('@ucanto/interface').Principal
 *   endpoint: URL
 *   proof: import('@ucanto/interface').Proof
 *   weight: number
 *   insertedAt: Date
 *   updatedAt?: Date
 * }} StorageProvider
 */

/**
 * @param {string} region
 * @param {string} tableName
 * @param {import('@ucanto/interface').Signer} serviceID
 * @param {object} [options]
 * @param {string} [options.endpoint]
 * @returns {BlobAPI.RoutingService}
 */
export const createRoutingService = (region, tableName, serviceID, options) => {
  const dynamo = getDynamoClient({ region, endpoint: options?.endpoint })
  return useRoutingService(dynamo, tableName, serviceID)
}

/**
 * @param {import('@aws-sdk/client-dynamodb').DynamoDBClient} dynamo
 * @param {string} tableName
 * @param {import('@ucanto/interface').Signer} serviceID
 * @returns {BlobAPI.RoutingService}
 */
export const useRoutingService = (dynamo, tableName, serviceID) => ({
  selectStorageProvider: async (digest) => {
    /** @type {import('@ucanto/interface').Principal[]} */
    const storageProviders = []
    /** @type {Record<string, import('@aws-sdk/client-dynamodb').AttributeValue>|undefined} */
    let cursor
    while (true) {
      const cmd = new ScanCommand({
        TableName: tableName,
        ExclusiveStartKey: cursor,
        AttributesToGet: ['provider']
      })
      const res = await dynamo.send(cmd)
      for (const item of res.Items ?? []) {
        const raw = unmarshall(item)
        storageProviders.push(parse(raw.provider))
      }
      cursor = res.LastEvaluatedKey
      if (!cursor) break
    }

    if (!storageProviders.length) {
      return error(new CandidateUnavailableError())
    }

    const provider = storageProviders[getRandomInt(storageProviders.length)]
    return ok(provider)
  },
  configureInvocation: async (provider, capability, options) => {
    const cmd = new GetItemCommand({
      TableName: tableName,
      Key: marshall({ provider: provider.did() })
    })
    const res = await dynamo.send(cmd)
    if (!res.Item) {
      return error(new ProofUnavailableError(`provider not found: ${provider.did()}`))
    }
    const { endpoint, proof } = await decodeStorageProviderRecord(res.Item)

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

/** @param {Record<string, any>} item */
const decodeStorageProviderRecord = async item => {
  const raw = unmarshall(item)
  const cid = Link.parse(raw.proof, base64)
  const { ok: proof, error } = await extract(cid.multihash.digest)
  if (!proof) {
    throw new Error(`failed to extract proof for provider: ${raw.provider}`, { cause: error })
  }
  return {
    provider: parse(raw.provider),
    endpoint: new URL(raw.endpoint),
    proof,
    weight: raw.weight ?? 100,
    insertedAt: new Date(raw.insertedAt),
    updatedAt: raw.updatedAt ? new Date(raw.updatedAt) : undefined
  }
}

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
