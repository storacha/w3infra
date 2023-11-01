import { randomLink } from '../../test/helpers/dag.js'
import { Schema } from '../../data/lib.js'
import { createCustomerStore } from '../../tables/customer.js'
import { mustGetEnv } from '../../functions/lib.js'
import { getDynamo } from './lib.js'

/**
 * Add a customer to the billing system. 
 * `customer` is a did:mailto: address and `account` is a Stripe customer ID.
 *
 * $ billing customer add did:mailto:protocol.ai:test0 stripe:cus_9s6XKzkNRiz8i3 --product lite
 * Added did:mailto:protocol.ai:test0
 *
 * @param {string} rawCustomer
 * @param {string} rawAccount
 * @param {object} options
 * @param {string} options.product
 */
export async function customerAdd (rawCustomer, rawAccount, options) {
  const customer = Schema.did({ method: 'mailto' }).from(rawCustomer)
  const account = Schema.uri({ protocol: 'stripe:' }).from(rawAccount)
  const product = options.product ?? 'lite'
  const now = new Date()
  const tableName = mustGetEnv('CUSTOMER_TABLE_NAME')
  const dynamo = getDynamo()
  const customerStore = createCustomerStore(dynamo, { tableName })
  const res = await customerStore.put({
    cause: randomLink(),
    account,
    customer,
    product,
    insertedAt: now,
    updatedAt: now,
  })
  console.log(res)
}
