import {
  DescribeTableCommand,
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
  QueryCommand,
} from '@aws-sdk/client-dynamodb'
import { Failure } from '@ucanto/server'
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb'

/**
 * @typedef {import('../types').SubscriptionTable} SubscriptionTable
 * @typedef {import('../types').SubscriptionInput} SubscriptionInput
 */

export class ConflictError extends Failure {
  /**
   * @param {object} input
   * @param {string} input.message
   */
  constructor({ message }) {
    super(message)
    this.name = 'ConflictError'
  }
}

/**
 * Abstraction layer to handle operations on Store Table.
 *
 * @param {string} region
 * @param {string} tableName
 * @param {object} [options]
 * @param {string} [options.endpoint]
 */
export function createSubscriptionTable (region, tableName, options = {}) {
  const dynamoDb = new DynamoDBClient({
    region,
    endpoint: options.endpoint,
  })

  return useSubscriptionTable(dynamoDb, tableName)
}

/**
 * @param {DynamoDBClient} dynamoDb
 * @param {string} tableName
 * @returns {SubscriptionTable}
 */
export function useSubscriptionTable (dynamoDb, tableName) {
  return {
    /**
     * Record the fact that a subscription is consuming a provider via a subscription
     *
     * @param {SubscriptionInput} item
     * @returns {Promise<{}>}
     */
    add: async ({ customer, provider, subscription, cause }) => {
      const insertedAt = new Date().toISOString()

      const item = {
        customer,
        provider,
        subscription,
        cause: cause.toString(),
        insertedAt,
      }
      try {
        await dynamoDb.send(new PutItemCommand({
          TableName: tableName,
          ConditionExpression: `attribute_not_exists(consumer) AND attribute_not_exists(subscription)`,
          Item: marshall(item, { removeUndefinedValues: true }),
        }))
        return {}
      } catch (error) {
        const error_ = error instanceof Error && error.message === 'The conditional request failed' ? new ConflictError({
          message: `Customer ${item.customer} cannot be given a subscription for ${item.provider}: it already has a subscription`
        }) : error;
        throw error_;
      }
    },

    /**
     * Get a subscription by ID.
     * 
     * @param {import('@web3-storage/upload-api').ProviderDID} provider 
     * @param {string} subscription 
     * @returns 
     */
    get: async (provider, subscription) => {
      const response = await dynamoDb.send(new GetItemCommand({
        TableName: tableName,
        Key: {
          provider: {
            S: provider
          },
          subscription: {
            S: subscription
          }
        }
      }))
      return response.Item ?
        (
          {
            customer: unmarshall(response.Item).customer
          }
        ) : null
    },

    /**
     * get number of stored items
     */
    count: async () => {
      const result = await dynamoDb.send(new DescribeTableCommand({
        TableName: tableName
      }))

      return BigInt(result.Table?.ItemCount ?? -1)
    },

    findProviderSubscriptionsForCustomer: async (customer, provider) => {
      const cmd = new QueryCommand({
        TableName: tableName,
        IndexName: 'customer',
        KeyConditionExpression: "customer = :customer AND provider = :provider",
        ExpressionAttributeValues: {
          ':customer': { S: customer },
          ':provider': { S: provider }
        },
        ProjectionExpression: 'subscription'
      })
      const response = await dynamoDb.send(cmd)
      return response.Items ? response.Items.map(i => {
        return {
          subscription: unmarshall(i).subscription
        }
      }) : []
    }
  }
}