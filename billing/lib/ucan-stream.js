import * as ServiceBlobCaps from '@storacha/capabilities/blob'
import * as BlobCaps from '@storacha/capabilities/space/blob'
import * as StoreCaps from '@storacha/capabilities/store'
import * as DID from '@ipld/dag-ucan/did'

/**
 * Filters UCAN stream messages that are receipts for invocations that alter
 * the store size for a resource and extracts the relevant information about
 * the delta.
 *
 * @param {import('./api.js').UcanStreamMessage[]} messages
 * @returns {import('./api.js').UsageDelta[]}
 */
export const findSpaceUsageDeltas = messages => {
  const deltas = []
  for (const message of messages) {
    if (!isReceipt(message)) continue

    /** @type {import('@ucanto/interface').DID|undefined} */
    let resource
    /** @type {number|undefined} */
    let size
    if (isReceiptForCapability(message, ServiceBlobCaps.allocate) && isServiceBlobAllocateSuccess(message.out)) {
      const spaceDigestBytes = message.value.att[0].nb?.space
      if (!spaceDigestBytes) throw new Error('missing space in allocate caveats')
      resource = DID.decode(spaceDigestBytes).did()
      size = message.out.ok.size
    } else if (isReceiptForCapability(message, BlobCaps.remove) && isBlobRemoveSuccess(message.out)) {
      resource = /** @type {import('@ucanto/interface').DID} */ (message.value.att[0].with)
      size = -message.out.ok.size
    // TODO: remove me LEGACY store/add
    } else if (isReceiptForCapability(message, StoreCaps.add) && isStoreAddSuccess(message.out)) {
      resource = /** @type {import('@ucanto/interface').DID} */ (message.value.att[0].with)
      size = message.out.ok.allocated
    // TODO: remove me LEGACY store/remove
    } else if (isReceiptForCapability(message, StoreCaps.remove) && isStoreRemoveSuccess(message.out)) {
      resource = /** @type {import('@ucanto/interface').DID} */ (message.value.att[0].with)
      size = -message.out.ok.size
    }

    // Is message is a repeat store/add for the same shard or not a valid
    // store/add or store/remove receipt?
    if (resource == null || size == 0 || size == null) {
      continue
    }

    /** @type {import('./api.js').UsageDelta} */
    const delta = {
      resource,
      cause: message.invocationCid,
      delta: size,
      // TODO: use receipt timestamp per https://github.com/web3-storage/w3up/issues/970
      receiptAt: message.ts
    }
    deltas.push(delta)
  }
  return deltas
}

/**
 * Attributes a raw usage delta to a customer and stores the collected
 * information in the space diff store.
 *
 * Space diffs are keyed by `customer`, `provider`, `space` and `cause` so
 * multiple calls to this function with the same data must not add _another_
 * record to the store.
 *
 * @param {import('./api.js').UsageDelta[]} deltas
 * @param {{
 *   spaceDiffStore: import('./api.js').SpaceDiffStore
 *   consumerStore: import('./api.js').ConsumerStore
 * }} ctx
 */
export const storeSpaceUsageDeltas = async (deltas, ctx) => {
  const spaceDiffResults = await Promise.all(deltas.map(async delta => {
    const consumerList = await ctx.consumerStore.list({ consumer: delta.resource })
    if (consumerList.error) return consumerList

    const diffs = []
    // There should only be one subscription per provider, but in theory you
    // could have multiple providers for the same consumer (space).
    for (const consumer of consumerList.ok.results) {
      diffs.push({
        provider: consumer.provider,
        subscription: consumer.subscription,
        space: delta.resource,
        cause: delta.cause,
        delta: delta.delta,
        receiptAt: delta.receiptAt,
        insertedAt: new Date()
      })
    }
    return { ok: diffs, error: undefined }
  }))

  const spaceDiffs = []
  for (const res of spaceDiffResults) {
    if (res.error) return res
    spaceDiffs.push(...res.ok)
  }

  return ctx.spaceDiffStore.batchPut(spaceDiffs)
}

/**
 * @param {import('./api.js').UcanStreamMessage} m
 * @returns {m is import('./api.js').UcanReceiptMessage}
 */
const isReceipt = m => m.type === 'receipt'

/**
 * @param {import('@ucanto/interface').Result} r
 * @returns {r is { ok: import('@storacha/capabilities/types').BlobAllocateSuccess }}
 */
const isServiceBlobAllocateSuccess = r =>
  !r.error &&
  r.ok != null &&
  typeof r.ok === 'object' &&
  'size' in r.ok &&
  (typeof r.ok.size === 'number')

/**
 * @param {import('@ucanto/interface').Result} r
 * @returns {r is { ok: import('@storacha/capabilities/types').SpaceBlobRemoveSuccess }}
 */
const isBlobRemoveSuccess = r =>
  !r.error &&
  r.ok != null &&
  typeof r.ok === 'object' &&
  'size' in r.ok &&
  (typeof r.ok.size === 'number')

/**
 * @param {import('@ucanto/interface').Result} r
 * @returns {r is { ok: import('@storacha/capabilities/types').StoreAddSuccess }}
 */
const isStoreAddSuccess = r =>
  !r.error &&
  r.ok != null &&
  typeof r.ok === 'object' &&
  'status' in r.ok &&
  (r.ok.status === 'done' || r.ok.status === 'upload')

/**
 * @param {import('@ucanto/interface').Result} r
 * @returns {r is { ok: import('@storacha/capabilities/types').StoreRemoveSuccess }}
 */
const isStoreRemoveSuccess = r =>
  !r.error &&
  r.ok != null &&
  typeof r.ok === 'object' &&
  'size' in r.ok

/**
 * @template {import('@ucanto/interface').Ability} Can
 * @template {import('@ucanto/interface').Unit} Caveats
 * @param {import('./api.js').UcanReceiptMessage} m
 * @param {import('@ucanto/interface').TheCapabilityParser<import('@ucanto/interface').CapabilityMatch<Can, import('@ucanto/interface').Resource, Caveats>>} cap
 * @returns {m is import('./api.js').UcanReceiptMessage<[import('@ucanto/interface').Capability<Can, import('@ucanto/interface').Resource, Caveats>]>}
 */
const isReceiptForCapability = (m, cap) => m.value.att.some(c => c.can === cap.can)
