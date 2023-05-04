import {
  DynamoDBClient,
  QueryCommand,
  PutItemCommand,
  DescribeTableCommand,
} from '@aws-sdk/client-dynamodb'
import { Failure } from '@ucanto/server'
import { marshall, } from '@aws-sdk/util-dynamodb'

/**
 * Abstraction layer to handle operations on Store Table.
 *
 * @param {string} region
 * @param {string} tableName
 * @param {import('@ucanto/interface').DID<'web'>[]} services
 * @param {object} [options]
 * @param {string} [options.endpoint]
 */
export function createProvisionsTable (region, tableName, services, options = {}) {
  const dynamoDb = new DynamoDBClient({
    region,
    endpoint: options.endpoint,
  })

  return useProvisionsTable(dynamoDb, tableName, services)
}
/**
 * @param {DynamoDBClient} dynamoDb
 * @param {string} tableName
 * @param {import('@ucanto/interface').DID<'key'>} consumer
 */
async function hasStorageProvider (dynamoDb, tableName, consumer) {
  const cmd = new QueryCommand({
    TableName: tableName,
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
  return itemCount > 0
}

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
 * @param {DynamoDBClient} dynamoDb
 * @param {string} tableName
 * @param {import('@ucanto/interface').DID<'web'>[]} services
 * @returns {import('../access-types').ProvisionsStorage}
 */
export function useProvisionsTable (dynamoDb, tableName, services) {
  return {
    services,
    hasStorageProvider: async (consumer) => {
      return hasStorageProvider(dynamoDb, tableName, consumer)
    },
    /**
     * ensure item is stored
     *
     * @param item - provision to store
     */
    put: async (item) => {
      const row = {
        cid: item.invocation.cid.toString(),
        consumer: item.space,
        provider: item.provider,
        sponsor: item.account,
      }
      const hasProvider = await hasStorageProvider(dynamoDb, tableName, row.consumer)
      if (hasProvider) {
        return new ConflictError({
          message: `Space ${row.consumer} cannot be provisioned with ${row.provider}: it already has a provider`
        })
      }
      await dynamoDb.send(new PutItemCommand({
        TableName: tableName,
        Item: marshall(row)
      }))
      return {}
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
