const STREAM_TYPE = {
  WORKFLOW: 'workflow',
  RECEIPT: 'receipt',
}

/**
 * @param {import('./types.js').UcanStreamInvocation} ucanInvocation
 */
export function hasOkReceipt(ucanInvocation) {
  return (
    ucanInvocation.type === STREAM_TYPE.RECEIPT &&
    Boolean(ucanInvocation.out?.ok)
  )
}

/**
 *
 * @param {import('../billing/lib/api.ts').Customer} customer
 * @param {Record<string, import('../billing/lib/api.ts').Product>} productInfo
 * @returns {import("@ucanto/interface").Result<number, import("@storacha/capabilities/types").PlanNotFound>}
 */
export function planLimit(customer, productInfo) {
  // If customer has reserved capacity (forge network), use that as the hard limit
  if (customer.reservedCapacity !== undefined) {
    // Reserved capacity is stored in TiB, convert to bytes
    const TiB = 1024 * 1024 * 1024 * 1024
    return { ok: customer.reservedCapacity * TiB }
  }

  // Otherwise, use plan-based logic (hot network)
  const plan = productInfo[customer.product]
  if (!plan) {
    return {
      error: {
        name: 'PlanNotFound',
        message: `could not find plan for ${customer.product}`,
      },
    }
  }
  return { ok: plan.allowOverages ? 0 : plan.included }
}
