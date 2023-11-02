/**
 * 
 * @param {import("@web3-storage/w3infra-billing/lib/api").CustomerStore} customerStore
 * @returns {import("@web3-storage/upload-api").PlansStorage}
 */
export function usePlansStore(customerStore) {
  return {
    get: async (customer) => {
      const result = await customerStore.get({ customer })
      return result.ok ?
        {
          ok: {
            product: /** @type {import("@ucanto/interface").DID} */(result.ok.product),
            updatedAt: result.ok.updatedAt.toISOString()
          }
        } : {
          error: {
            name: 'PlanNotFound',
            message: result.error.message
          }
        }
    },

    set: async (customer, plan) => {
      return await customerStore.updateProduct(customer, plan)
    }
  }
}