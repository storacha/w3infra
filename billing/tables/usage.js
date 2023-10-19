import { DynamoDBClient, PutItemCommand } from '@aws-sdk/client-dynamodb'
import { marshall } from '@aws-sdk/util-dynamodb'

/**
 * @param {string} region 
 * @param {string} table
 * @param {object} [options]
 * @param {URL} [options.endpoint]
 */
export const createUsageStore = (region, table, options) => {
  const dynamo = new DynamoDBClient({ region, endpoint: options?.endpoint?.toString() })
  return useUsageStore(dynamo, table)
}

/**
 * @param {DynamoDBClient} dynamo 
 * @param {string} table
 * @returns {import('../types').UsageStore}
 */
export const useUsageStore = (dynamo, table) => ({
  async put (input) {
    const cmd = new PutItemCommand({
      TableName: table,
      Item: marshall({
        customer: input.customer,
        account: input.account,
        product: input.product,
        space: input.space,
        usage: input.usage,
        period: `${input.from.toISOString()} - ${input.to.toISOString()}`,
        insertedAt: new Date().toISOString()
      })
    })
    await dynamo.send(cmd)
    return { ok: {} }
  }
})
