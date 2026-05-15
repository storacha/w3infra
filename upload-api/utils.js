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
 * @returns {import("@ucanto/interface").Result<number, import("@storacha/capabilities/types").PlanGetFailure>}
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

  // If customer is on the reserved capacity plan (forge network only), use their reserved capacity as the hard limit
  if (customer.product === 'did:web:reserved.storacha.network') {
    if (customer.reservedCapacity === undefined) {
      return {
        error: {
          name: 'MissingCapacity',
          message: `customer ${customer.customer} is on reserved plan but has no reserved capacity set`,
        },
      }
    }

    return { ok: customer.reservedCapacity }
  }

  // Otherwise, use plan-based logic (hot network)
  return { ok: plan.allowOverages ? 0 : plan.included }
}

/**
 * Strict-`'true'` parser matching the convention used by other env-driven
 * flags in this file's host workspace (e.g. `DISABLE_CUSTOMER_REGISTRATION`,
 * `DISABLE_IPNI_PUBLISHING`). Any value other than the literal string
 * `"true"` — including `"1"`, `"false"`, the empty string, and `undefined` —
 * is treated as `false`.
 *
 * @param {Record<string, string|undefined>} env
 * @returns {boolean}
 */
export const parseWritesDisabled = (env) => env.WRITES_DISABLED === 'true'
