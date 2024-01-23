import { Failure } from '@ucanto/server'

/**
 * 
 * @param {import("@web3-storage/w3infra-billing/lib/api").CustomerStore} customerStore
 * @param {import('../types.js').BillingProvider} billingProvider
 * @returns {import("@web3-storage/upload-api").PlansStorage}
 */
export function usePlansStore(customerStore, billingProvider) {
  return {
    get: async (customer) => {
      const result = await customerStore.get({ customer })
      return result.ok ?
        {
          ok: {
            product: /** @type {import("@ucanto/interface").DID} */(result.ok.product),
            updatedAt: (result.ok.updatedAt || result.ok.insertedAt).toISOString()
          }
        } : {
          error: {
            name: 'PlanNotFound',
            message: result.error.message
          }
        }
    },

    set: async (customer, plan) => {
      try {
        const hasCustomerResponse = await billingProvider.hasCustomer(customer)
        if (hasCustomerResponse.ok) {
          await billingProvider.setPlan(customer, plan)
          return await customerStore.updateProduct(customer, plan)
        } else {
          if (hasCustomerResponse.error) {
            return hasCustomerResponse
          } else {
            return { error: new Failure(`billing provider does not have customer for ${customer}`) }
          }
        }
      } catch (/** @type {any} */ err) {
        return { error: err }
      }
    }
  }
}