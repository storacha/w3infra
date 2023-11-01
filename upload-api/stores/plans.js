/**
 * 
 * @param {import("../types").CustomerTable} customerTable 
 * @returns {import("@web3-storage/upload-api").PlansStorage}
 */
export function usePlansStore(customerTable) {
  return {
    get: async (customer) => {
      const result = await customerTable.get(customer)
      if (result.ok){
        return {
          ok: {
            product: /** @type {import("@ucanto/interface").DID} */(result.ok.product),
            updatedAt: result.ok.updatedAt
          }
        }
      } else {
        return {
          error: {
            name: 'PlanNotFound',
            message: result.error.message
          }
        }
      }
    },

    set: async (customer, plan) => {
      return {
        error: {
          name: 'Unimplemented',
          message: 'PlansStorage#set is not implemented'
        }
      }
    }
  }
}