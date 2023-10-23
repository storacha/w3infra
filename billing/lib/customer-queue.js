/**
 * @param {import('./api').CustomerBillingInstruction} instruction 
 * @param {{
 *   subscriptionStore: import('./api').SubscriptionStore
 *   consumerStore: import('./api').ConsumerStore
 *   spaceBillingQueue: import('./api').SpaceBillingQueue
 * }} stores
 * @returns {Promise<import('@ucanto/interface').Result>}
 */
export const handleCustomerBillingInstruction = async (instruction, {
  subscriptionStore,
  consumerStore,
  spaceBillingQueue
}) => {
  console.log(`processing customer billing instruction for: ${instruction.customer}`)
  console.log(`period: ${instruction.from.toISOString()} - ${instruction.to.toISOString()}`)

  let cursor
  while (true) {
    const subsList = await subscriptionStore.list({ customer: instruction.customer }, { cursor })
    if (subsList.error) return subsList

    // TODO: this is going to be inefficient for any client with many spaces
    // and may eventually cause billing to fail.
    for (const s of subsList.ok.results) {
      const consumerGet = await consumerStore.get({
        subscription: s.subscription,
        provider: s.provider
      })
      if (consumerGet.error) return consumerGet

      console.log(`adding space billing instruction for: ${consumerGet.ok.consumer}`)
      const queueAdd = await spaceBillingQueue.add({
        ...instruction,
        provider: s.provider,
        space: consumerGet.ok.consumer
      })
      if (queueAdd.error) return queueAdd
    }
    
    if (!subsList.ok.cursor) break
    cursor = subsList.ok.cursor
  }

  return { ok: {} }
}
