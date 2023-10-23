import * as StoreCaps from '@web3-storage/capabilities/store'

/**
 * @param {import('./api').UcanStreamMessage} message
 * @param {{
 *   spaceDiffStore: import('./api').SpaceDiffStore
 *   subscriptionStore: import('./api').SubscriptionStore
 *   consumerStore: import('./api').ConsumerStore
 * }} stores
 * @returns {Promise<import('@ucanto/interface').Result>}
 */
export const handleUcanStreamMessage = async (message, { spaceDiffStore, subscriptionStore, consumerStore }) => {
  if (!isReceipt(message)) return { ok: {} }

  /** @type {number|undefined} */
  let size
  if (isReceiptForCapability(message, StoreCaps.add) && isStoreAddSuccess(message.out)) {
    size = message.value.att[0].nb?.size
  } else if (isReceiptForCapability(message, StoreCaps.remove) && isStoreRemoveSuccess(message.out)) {
    size = -message.out.ok.size
  } else {
    return { ok: {} }
  }

  if (size == null) {
    return { error: new Error(`missing size: ${message.carCid}`) }
  }

  const space = /** @type {import('@ucanto/interface').DID} */ (message.value.att[0].with)
  const consumerList = await consumerStore.list({ consumer: space })
  if (consumerList.error) return consumerList

  // There should only be one subscription per provider, but in theory you
  // could have multiple providers for the same consumer (space).
  for (const consumer of consumerList.ok.results) {
    const subGet = await subscriptionStore.get({ provider: consumer.provider, subscription: consumer.subscription })
    if (subGet.error) return subGet

    const spaceDiffPut = await spaceDiffStore.put({
      customer: subGet.ok.customer,
      provider: consumer.provider,
      subscription: subGet.ok.subscription,
      space,
      cause: message.invocationCid,
      change: size,
      // TODO: use receipt timestamp per https://github.com/web3-storage/w3up/issues/970
      receiptAt: message.ts,
      insertedAt: new Date()
    })
    if (spaceDiffPut.error) return spaceDiffPut
  }

  return { ok: {} }
}

/**
 * @param {import('./api').UcanStreamMessage} m
 * @returns {m is import('./api').UcanReceiptMessage}
 */
const isReceipt = m => m.type === 'receipt'

/**
 * @param {import('@ucanto/interface').Result} r
 * @returns {r is { ok: import('@web3-storage/capabilities/types').StoreAddSuccess }}
 */
const isStoreAddSuccess = r =>
  !r.error &&
  r.ok != null &&
  typeof r.ok === 'object' &&
  'status' in r.ok &&
  (r.ok.status === 'done' || r.ok.status === 'upload')

/**
 * @param {import('@ucanto/interface').Result} r
 * @returns {r is { ok: import('@web3-storage/capabilities/types').StoreRemoveSuccess }}
 */
const isStoreRemoveSuccess = r =>
  !r.error &&
  r.ok != null &&
  typeof r.ok === 'object' &&
  'size' in r.ok

/**
 * @template {import('@ucanto/interface').Ability} Can
 * @template {import('@ucanto/interface').Unit} Caveats
 * @param {import('./api').UcanReceiptMessage} m
 * @param {import('@ucanto/interface').TheCapabilityParser<import('@ucanto/interface').CapabilityMatch<Can, import('@ucanto/interface').Resource, Caveats>>} cap
 * @returns {m is import('./api').UcanReceiptMessage<[import('@ucanto/interface').Capability<Can, import('@ucanto/interface').Resource, Caveats>]>}
 */
const isReceiptForCapability = (m, cap) => m.value.att.some(c => c.can === cap.can)
