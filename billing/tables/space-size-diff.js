import { DynamoDBClient, PutItemCommand } from '@aws-sdk/client-dynamodb'
import { marshall } from '@aws-sdk/util-dynamodb'

/**
 * @param {string} region 
 * @param {string} table
 * @param {object} [options]
 * @param {URL} [options.endpoint]
 */
export const createSpaceSizeDiffStore = (region, table, options) => {
  const dynamo = new DynamoDBClient({ region, endpoint: options?.endpoint?.toString() })
  return useSpaceSizeDiffStore(dynamo, table)
}

/**
 * @param {DynamoDBClient} dynamo 
 * @param {string} table
 * @returns {import('../types').SpaceSizeDiffStore}
 */
export const useSpaceSizeDiffStore = (dynamo, table) => ({
  async put (input) {
    const cmd = new PutItemCommand({
      TableName: table,
      Item: marshall({
        customer: input.customer,
        space: input.space,
        provider: input.provider,
        subscription: input.subscription,
        cause: input.cause.toString(),
        change: input.change,
        receiptAt: input.receiptAt.getTime(),
        insertedAt: new Date().toUTCString()
      })
    })
    await dynamo.send(cmd)
    return { ok: {} }
  }
})
