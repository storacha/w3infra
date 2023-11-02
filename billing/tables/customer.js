import { connectTable, createStoreGetterClient, createStoreListerClient, createStorePutterClient } from './client.js'
import { validate, encode, encodeKey, decode } from '../data/customer.js'
import { DynamoDBClient, QueryCommand, UpdateItemCommand } from '@aws-sdk/client-dynamodb'
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb'
import { RecordNotFound, StoreOperationFailure } from './lib.js'

/**
 * Stores customer details.
 *
 * @type {import('@serverless-stack/resources').TableProps}
 */
export const customerTableProps = {
  fields: {
    /** CID of the UCAN invocation that set it to the current value. */
    cause: 'string',
    /** DID of the user account e.g. `did:mailto:agent`. */
    customer: 'string',
    /**
     * Opaque identifier representing an account in the payment system.
     *
     * e.g. Stripe customer ID (stripe:cus_9s6XKzkNRiz8i3)
     */
    account: 'string',
    /** Unique identifier of the product a.k.a tier. */
    product: 'string',
    /** ISO timestamp record was inserted. */
    insertedAt: 'string',
    /** ISO timestamp record was updated. */
    updatedAt: 'string'
  },
  primaryIndex: { partitionKey: 'customer' },
  globalIndexes: {
    account: { partitionKey: 'account', projection: ['customer'] }
  }
}

/**
 * 
 * @param {DynamoDBClient} client 
 * @param {string} tableName
 * @param {string} customer 
 * @param {string} product 
 * @returns 
 */
async function setProductForCustomer(client, tableName, customer, product) {
  try {
    const res = await client.send(new UpdateItemCommand({
      TableName: tableName,
      Key: marshall({ customer }),
      UpdateExpression: 'SET product = :product',
      ExpressionAttributeValues: marshall({ product })
    }))
    if (res.$metadata.httpStatusCode !== 200) {
      throw new Error(`unexpected status putting item to table: ${res.$metadata.httpStatusCode}`)
    }
    return { ok: {} }
  } catch (/** @type {any} */ err) {
    console.error(err)
    return { error: new StoreOperationFailure(err.message) }
  }
}

/**
 * @param {{ region: string } | import('@aws-sdk/client-dynamodb').DynamoDBClient} conf
 * @param {{ tableName: string }} context
 * @returns {import('../lib/api').CustomerStore}
 */
export const createCustomerStore = (conf, { tableName }) => ({
  ...createStoreGetterClient(conf, { tableName, encodeKey, decode }),
  ...createStorePutterClient(conf, { tableName, validate, encode }),
  ...createStoreListerClient(conf, {
    tableName,
    encodeKey: () => ({ ok: {} }),
    decode
  }),
  async updateProductForCustomer(customer, product) {
    const client = connectTable(conf)
    return setProductForCustomer(client, tableName, customer, product)
  },
  async updateProductForAccount(account, product) {
    const client = connectTable(conf)
    const res = await client.send(new QueryCommand({
      TableName: tableName,
      IndexName: 'account',
      KeyConditionExpression: 'account = :account',
      ExpressionAttributeValues: marshall({ account })
    }))
    if (res.Items) {
      const item = unmarshall(res.Items[0])
      return setProductForCustomer(client, tableName, item.customer, product)
    } else {
      return { error: new RecordNotFound(account) }
    }
  }
})
