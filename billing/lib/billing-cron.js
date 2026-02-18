/**
 * Add a billing instruction for the given time period to the queue for every
 * customer in the store.
 *
 * A failure to enqueue data for all customers will require this function to be
 * called again with the same data, since there is no way to resume (customers
 * are always being added to the table). It must be possible to do this safely
 * so that failures do not cause some customers to be billed multiple times in
 * the same period when a failure occurs.
 *
 * @param {{ from: Date, to: Date }} period
 * @param {{
 *   customerStore: import('./api.js').CustomerStore
 *   customerBillingQueue: import('./api.js').CustomerBillingQueue
 * }} ctx
 * @returns {Promise<import('@ucanto/interface').Result<import('@ucanto/interface').Unit>>}
 */
export const enqueueCustomerBillingInstructions = async (period, ctx) => {
  /** @type {string|undefined} */
  let cursor
  while (true) {
    /**
     * Here we list all customers, even though some customers are not billable anymore.
     * Wouldn't be better to filter only active/billable customers here?
     */
    const customerList = await ctx.customerStore.list({}, { cursor, size: 1000 })
    if (customerList.error) return customerList

    for (const c of customerList.ok.results) {
      if (!c.account) continue

      console.log(`Adding customer billing instruction for: ${c.customer}`)
      const queueAdd = await ctx.customerBillingQueue.add({
        customer: c.customer,
        account: c.account,
        product: c.product,
        from: period.from,
        to: period.to
      })
      if (queueAdd.error) return queueAdd
    }

    if (!customerList.ok.cursor) break
    cursor = customerList.ok.cursor
  }

  return { ok: {} }
}
