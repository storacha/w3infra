import { startOfLastMonth, startOfMonth, } from './util.js'

/**
 * @param {{
 *   customerStore: import('./api.js').CustomerStore
 *   customerBillingQueue: import('./api.js').CustomerBillingQueue
 * }} ctx
 * @returns {Promise<import('@ucanto/interface').Result>}
 */
export const handleCronTick = async ctx => {
  const from = startOfLastMonth()
  const to = startOfMonth()

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
