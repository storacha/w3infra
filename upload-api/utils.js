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
