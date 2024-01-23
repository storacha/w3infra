/**
 * @returns {import("../../types").BillingProvider}
 */
export function createTestBillingProvider() {
  /**
   * 
   * Initialize this with data that matches the test defined in @web3-storage/w3up.
   * 
   * Normally this will be set up in the billing provider itself (in the 
   * current implementation this means sending them to Stripe) so we 
   * initialize it with values that will allow the test to pass.
   * 
   * @type {Record<import("@web3-storage/upload-api").AccountDID, import("@ucanto/interface").DID>}
   */
  const customers = {
    'did:mailto:example.com:alice': 'did:web:initial.web3.storage'
  }
  return {
    async hasCustomer(customer) {
      return { ok: !!customers[customer] }
    },

    async setPlan(customer, product) {
      customers[customer] = product
      return { ok: {} }
    }
  }
}