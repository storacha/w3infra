/**
 * @param {{
 *   customerStore: import('./api').CustomerStore
 *   customerBillingQueue: import('./api').CustomerBillingQueue
 * }} stores
 * @returns {Promise<import('@ucanto/interface').Result>}
 */
export const handleCronTick = async ({ customerStore, customerBillingQueue }) => {
  const from = startOfMonth()
  const to = startOfNextMonth()

  let cursor
  while (true) {
    const customerList = await customerStore.list({}, { cursor, size: 1000 })
    if (customerList.error) return customerList

    for (const c of customerList.ok.results) {
      console.log(`adding customer billing instruction for: ${c.customer}`)
      const queueAdd = await customerBillingQueue.add({
        customer: c.customer,
        account: c.account,
        product: c.product,
        from,
        to
      })
      if (queueAdd.error) return queueAdd
    }
    
    if (!customerList.ok.cursor) break
    cursor = customerList.ok.cursor
  }

  return { ok: {} }
}

const startOfMonth = () => {
  const d = new Date()
  return new Date(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01T00:00:00.000Z`)
}

const startOfNextMonth = () => {
  const d = startOfMonth()
  d.setMonth(d.getMonth() + 1)
  return d
}
