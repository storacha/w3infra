import {
  DynamoDBClient,
  PutItemCommand,
  DescribeTableCommand,
  QueryCommand,
} from '@aws-sdk/client-dynamodb'
import { Failure } from '@ucanto/server'
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb'

/**
 * @typedef {import('../types').ConsumerTable} ConsumerTable
 * @typedef {import('../types').ConsumerInput} ConsumerInput
 */

/**
 * Abstraction layer to handle operations on Store Table.
 *
 * @param {string} region
 * @param {string} tableName
 * @param {object} [options]
 * @param {string} [options.endpoint]
 */
export function createConsumerTable (region, tableName, options = {}) {
  const dynamoDb = new DynamoDBClient({
    region,
    endpoint: options.endpoint,
  })

  return useConsumerTable(dynamoDb, tableName)
}


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
 * 
 * @param {DynamoDBClient} dynamoDb
 * @param {string} tableName 
 * @param {import('@ucanto/interface').DID} consumer 
 * @returns {Promise<import('@web3-storage/upload-api').ProviderDID[]>}
 */
async function getStorageProviders (dynamoDb, tableName, consumer) {
  const cmd = new QueryCommand({
    TableName: tableName,
    IndexName: 'consumer',
    KeyConditions: {
      consumer: {
        ComparisonOperator: 'EQ',
        AttributeValueList: [{ S: consumer }]
      }
    },
    AttributesToGet: ['provider']
  })
  const response = await dynamoDb.send(cmd)
  return response.Items ? response.Items.map(item => {
    const row = unmarshall(item)
    return /** @type {import('@web3-storage/upload-api').ProviderDID} */ (row.provider)
  }) : []
}

/**
 * @param {DynamoDBClient} dynamoDb
 * @param {string} tableName
 * @returns {ConsumerTable}
 */
export function useConsumerTable (dynamoDb, tableName) {
  return {
    /**
     * Get a consumer record.
     * 
     * @param {import('@web3-storage/upload-api').ProviderDID} provider the provider whose records we should query
     * @param {import('@ucanto/interface').DIDKey} consumer the consumer whose record we should return
     */
    get: async (provider, consumer) => {
      const response = await dynamoDb.send(new QueryCommand({
        TableName: tableName,
        IndexName: 'consumer',
        KeyConditionExpression: "consumer = :consumer and provider = :provider",
        ExpressionAttributeValues: {
          ':consumer': { S: consumer },
          ':provider': { S: provider }
        },
      }))
      if (response.Items && (response.Items.length > 0)) {
        const record = unmarshall(response.Items[0])
        return {
          subscription: record.subscription
        }
      } else {
        return null
      }
    },

    /**
     * Record the fact that a consumer is consuming a provider via a subscription
     *
     * @param {ConsumerInput} item
     * @returns {Promise<{}>}
     */
    add: async ({ consumer, provider, subscription, cause }) => {
      const insertedAt = new Date().toISOString()

      const row = {
        consumer,
        provider,
        subscription,
        cause: cause.toString(),
        insertedAt,
      }

      try {
        await dynamoDb.send(new PutItemCommand({
          TableName: tableName,
          Item: marshall(row),
          ConditionExpression: `(attribute_not_exists(subscription) AND attribute_not_exists(provider)) OR ((cause = :cause) AND (consumer = :consumer) AND (provider = :provider) AND (subscription = :subscription))`,
          ExpressionAttributeValues: {
            ':cause': { 'S': row.cause },
            ':consumer': { 'S': row.consumer },
            ':provider': { 'S': row.provider },
            ':subscription': { 'S': row.subscription }
          }
        }))
        return {}
      } catch (error) {
        const error_ = error instanceof Error && error.message === 'The conditional request failed' ? new ConflictError({
          message: `Space ${row.consumer} cannot be provisioned with ${row.subscription} and ${row.provider}: that subscription is already in use`
        }) : error;
        throw error_;
      }
    },

    getStorageProviders: async (consumer) => {
      return getStorageProviders(dynamoDb, tableName, consumer)
    },

    hasStorageProvider: async (consumer) => {
      const providers = await getStorageProviders(dynamoDb, tableName, consumer)
      return providers.length > 0
    },

    /**
     * get number of stored items
     */
    count: async () => {
      const result = await dynamoDb.send(new DescribeTableCommand({
        TableName: tableName
      }))

      return BigInt(result.Table?.ItemCount ?? -1)
    }
  }
}