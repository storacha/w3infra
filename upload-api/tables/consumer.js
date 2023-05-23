import {
  DynamoDBClient,
  PutItemCommand,
  DescribeTableCommand,
  QueryCommand,
} from '@aws-sdk/client-dynamodb'
import { Failure } from '@ucanto/server'
import { marshall } from '@aws-sdk/util-dynamodb'

/**
 * @typedef {import('../types').ConsumerTable} ConsumerTable
 * @typedef {import('../types').UnstableConsumerTable} UnstableConsumerTable
 * @typedef {import('../types').ConsumerInput} ConsumerInput
 * @typedef {import('../types').Consumer} Consumer
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
 * @param {DynamoDBClient} dynamoDb
 * @param {string} tableName
 * @returns {UnstableConsumerTable}
 */
export function useConsumerTable (dynamoDb, tableName) {
  return {
    /**
     * Record the fact that a consumer is consuming a provider via a subscription
     *
     * @param {ConsumerInput} item
     * @returns {Promise<Consumer>}
     */
    insert: async ({ consumer, provider, subscription, cause }) => {
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
          ConditionExpression: `attribute_not_exists(consumer) OR ((cause = :cause) AND (consumer = :consumer) AND (provider = :provider) AND (subscription = :subscription))`,
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
            message: `Space ${row.consumer} cannot be provisioned with ${row.provider}: it already has a provider`
          }) : error;
        throw error_;
      }
    },

    hasStorageProvider: async (consumer) => {
      const cmd = new QueryCommand({
        TableName: tableName,
        KeyConditions: {
          consumer: {
            ComparisonOperator: 'EQ',
            AttributeValueList: [{ S: consumer }]
          }
        },
        AttributesToGet: ['provider']
      })
      const response = await dynamoDb.send(cmd)
      const itemCount = response.Items?.length || 0
      return itemCount > 0
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

    /**
     * !!! the following methods are unstable and may be changed at any time !!!
     * !!!      they are included here for testing and design purposes       !!!
     */

    findConsumersByProvider: async (provider) => {
      const cmd = new QueryCommand({
        TableName: tableName,
        IndexName: 'provider',
        KeyConditions: {
          provider: {
            ComparisonOperator: 'EQ',
            AttributeValueList: [{ S: provider }]
          }
        },
        AttributesToGet: ['consumer']
      })
      const response = await dynamoDb.send(cmd)
      if (response.Items) {
        return response.Items.map(item => /** @type{import('@ucanto/interface').DID} */ (item.consumer.S))
      } else {
        return []
      }
    }
  }
}