/**
 * @returns {import("../../types").BillingProvider}
 */
export function createTestBillingProvider() {
  /**
   * @type {Record<import("@web3-storage/upload-api").AccountDID, import("@ucanto/interface").DID>}
   */
  const customers = {}
  return {
    async hasCustomer(customer) {
      return { ok: Boolean(customers[customer]) }
    },

    async setPlan(customer, product) {
      customers[customer] = product
      return { ok: {} }
    }
  }
}