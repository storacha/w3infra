/**
 * @param {{
 *   customerStore: import('./api').CustomerStore
 *   customerBillingQueue: import('./api').CustomerBillingQueue
 * }} ctx
 * @returns {Promise<import('@ucanto/interface').Result>}
 */
export const handleCronTick = async ctx => {
  const from = startOfMonth()
  const to = startOfNextMonth()

  let cursor
  while (true) {
    const customerList = await ctx.customerStore.list({}, { cursor, size: 1000 })
    if (customerList.error) return customerList

    for (const c of customerList.ok.results) {
      console.log(`Adding customer billing instruction for: ${c.customer}`)
      const queueAdd = await ctx.customerBillingQueue.add({
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
  d.setUTCDate(1)
  d.setUTCHours(0)
  d.setUTCMinutes(0)
  d.setUTCSeconds(0)
  d.setUTCMilliseconds(0)
  return d
}

const startOfNextMonth = () => {
  const d = startOfMonth()
  d.setUTCMonth(d.getUTCMonth() + 1)
  return d
}
