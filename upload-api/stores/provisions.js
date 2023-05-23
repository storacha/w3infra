import {
  QueryCommand,
  PutItemCommand,
  DescribeTableCommand,
} from '@aws-sdk/client-dynamodb'
import { Failure } from '@ucanto/server'
import { marshall, } from '@aws-sdk/util-dynamodb'

import { ConflictError as ConsumerConflictError } from '../tables/consumer.js'
import { ConflictError as SubscriptionConflictError } from '../tables/subscription.js'

class ConflictError extends Failure {
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
 * @param {import('../types').SubscriptionTable} subscriptionTable
 * @param {import('../types').ConsumerTable} consumerTable
 * @param {import('@ucanto/interface').DID<'web'>[]} services
 * @returns {import('@web3-storage/upload-api').ProvisionsStorage}
 */
export function useProvisionStore (subscriptionTable, consumerTable, services) {
  return {
    services,
    hasStorageProvider: async (consumer) => (
      { ok: await consumerTable.hasStorageProvider(consumer) }
    ),

    put: async (item) => {
      const { cause, consumer, customer, provider } = item
      // by setting subscription to customer we make it so each customer can have at most one subscription
      // TODO is this what we want?
      const subscription = customer

      try {
        await subscriptionTable.insert({
          cause: cause.cid,
          provider,
          customer,
          subscription
        })
      } catch (error) {
        // if we got a conflict error, ignore - it means the subscription already exists and
        // can be used to create a consumer/provider relationship below
        if (!(error instanceof SubscriptionConflictError)) {
          throw error
        }
      }

      try {
        await consumerTable.insert({
          cause: cause.cid,
          provider,
          consumer,
          subscription
        })
        return { ok: {} }
      } catch (error) {
        if (error instanceof ConsumerConflictError) {
          return {
            error
          }
        } else {
          throw error
        }
      }
    },

    /**
     * get number of stored items
     */
    count: async () => {
      return consumerTable.count()
    }
  }
}

/**
 * @param {import('@aws-sdk/client-dynamodb').DynamoDBClient} dynamoDb
 * @param {string} subscriptionsTableName
 * @param {string} consumersTableName
 * @param {import('@ucanto/interface').DID<'web'>[]} services
 * @returns {import('@web3-storage/upload-api').ProvisionsStorage}
 */
export function useProvisionsStorage (dynamoDb, subscriptionsTableName, consumersTableName, services) {
  return {
    services,
    hasStorageProvider: async (consumer) => {
      const cmd = new QueryCommand({
        TableName: consumersTableName,
        KeyConditions: {
          consumer: {
            ComparisonOperator: 'EQ',
            AttributeValueList: [{ S: consumer }]
          }
        },
        AttributesToGet: ['cid']
      })
      const response = await dynamoDb.send(cmd)
      const itemCount = response.Items?.length || 0
      return { ok: itemCount > 0 }
    },

    put: async (item) => {
      const row = {
        cid: item.cause.cid.toString(),
        consumer: item.consumer,
        provider: item.provider,
        customer: item.customer,
      }
      try {
        await dynamoDb.send(new PutItemCommand({
          TableName: subscriptionsTableName,
          Item: marshall(row),
          ConditionExpression: `attribute_not_exists(consumer) OR ((cid = :cid) AND (consumer = :consumer) AND (provider = :provider) AND (customer = :customer))`,
          ExpressionAttributeValues: {
            ':cid': { 'S': row.cid },
            ':consumer': { 'S': row.consumer },
            ':provider': { 'S': row.provider },
            ':customer': { 'S': row.customer }
          }
        }))
      } catch (error) {
        if (error instanceof Error && error.message === 'The conditional request failed') {
          return {
            error: new ConflictError({
              message: `Space ${row.consumer} cannot be provisioned with ${row.provider}: it already has a provider`
            })
          }
        } else {
          throw error
        }
      }
      return { ok: {} }
    },

    /**
     * get number of stored items
     */
    count: async () => {
      const result = await dynamoDb.send(new DescribeTableCommand({
        TableName: consumersTableName
      }))

      return BigInt(result.Table?.ItemCount ?? -1)
    }
  }
}