import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { createStorePutterClient } from '../../tables/client.js'
import { encode } from '../../data/customer.js'
import { randomLink } from '../../test/helpers/dag.js'
import { asDIDMailto } from '../../data/lib.js'

/**
 * Add a customer to the billing system. 
 * `customer` is a did:mailto: address and `account` is a Stripe customer ID.
 *
 *  $ billing customer add did:mailto:protocol.ai:test0 stripe:cus_9s6XKzkNRiz8i3 --product lite
 *  Added did:mailto:protocol.ai:test0
 * @param {string} rawCustomer
 * @param {string} account
 * @param {object} options
 * @param {string} options.product
 */
export async function addCustomer (rawCustomer, account, options) {
  console.log({rawCustomer, account, options})
  const customer = asDIDMailto(rawCustomer)
  const product = options.product ?? 'lite'
  const now = new Date()
  const tableName = process.env.CUSTOMER_TABLE_NAME
  if (!tableName) {
    throw new Error('CUSTOMER_TABLE_NAME must be set in ENV')
  }
  const region = process.env.AWS_REGION
  const dynamo = new DynamoDBClient({ region })
  const validate = () => { return {ok: ''} }
  const store = createStorePutterClient(dynamo, { tableName, encode, validate })
  const record = {
    cause: randomLink(),
    account,
    customer,
    product,
    insertedAt: now,
    updatedAt: now,
  }
  const res = await store.put(record)
  console.log(res)
}
