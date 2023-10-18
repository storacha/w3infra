import { DynamoDBClient, PutItemCommand, QueryCommand } from '@aws-sdk/client-dynamodb'
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb'
import { Failure } from '@ucanto/server'

/**
 * @param {string} region 
 * @param {string} table
 * @param {object} [options]
 * @param {URL} [options.endpoint]
 */
export const createCustomerStore = (region, table, options) => {
  const dynamo = new DynamoDBClient({ region, endpoint: options?.endpoint?.toString() })
  return useCustomerStore(dynamo, table)
}

/**
 * @param {DynamoDBClient} dynamo 
 * @param {string} table
 * @returns {import('../types').CustomerStore}
 */
export const useCustomerStore = (dynamo, table) => ({
  async list (options) {
    const exclusiveStartKey = options?.cursor
      ? marshall(options.cursor)
      : undefined

    const cmd = new QueryCommand({
      TableName: table,
      Limit: options?.size ?? 100,
      ScanIndexForward: !options?.pre,
      ExclusiveStartKey: exclusiveStartKey
    })
    const response = await dynamoDb.send(cmd)

    const results = (response.Items ?? []).map((i) => toUploadListItem(unmarshall(i)))
    const firstRootCID = results[0] ? results[0].root.toString() : undefined

    // Get cursor of the item where list operation stopped (inclusive).
    // This value can be used to start a new operation to continue listing.
    const lastKey =
      response.LastEvaluatedKey && unmarshall(response.LastEvaluatedKey)
    const lastRootCID = lastKey ? lastKey.root : undefined

    const before = options.pre ? lastRootCID : firstRootCID
    const after = options.pre ? firstRootCID : lastRootCID
    return {
      size: results.length,
      before,
      after,
      cursor: after,
      results: options.pre ? results.reverse() : results,
    }
  }
})
