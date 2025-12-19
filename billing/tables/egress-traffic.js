import { QueryCommand } from '@aws-sdk/client-dynamodb'
import { unmarshall } from '@aws-sdk/util-dynamodb'
import { createStorePutterClient, createStoreListerClient, connectTable } from './client.js'
import { validate, encode, lister, decode } from '../data/egress.js'

/**
 * Source of truth for egress traffic data.
 *
 * @type {import('sst/constructs').TableProps}
 */
export const egressTrafficTableProps = {
  fields: {
    /** Composite key with format: "space#resource" */
    pk: 'string',
    /** Composite key with format: "servedAt#cause" */
    sk: 'string',
    /** Space DID (did:key:...). */
    space: 'string',
    /** Customer DID (did:mailto:...). */
    customer: 'string',
    /** Resource CID. */
    resource: 'string',
    /** ISO timestamp of the event. */
    servedAt: 'string',
    /** Bytes served. */
    bytes: 'number',
    /** UCAN invocation ID that caused the egress traffic. */
    cause: 'string',
  },
  primaryIndex: { partitionKey: 'pk', sortKey: 'sk' },
  globalIndexes: {
    customer: {
      partitionKey: 'customer',
      sortKey: 'sk',
      projection: ['space', 'resource', 'bytes', 'cause', 'servedAt']
    },
    space: {
      partitionKey: 'space',
      sortKey: 'servedAt',
      projection: ['resource', 'bytes']
    }
  }
}

/**
 * @param {{ region: string } | import('@aws-sdk/client-dynamodb').DynamoDBClient} conf
 * @param {{ tableName: string }} context
 * @returns {import('../lib/api.js').EgressTrafficEventStore}
 */
export const createEgressTrafficEventStore = (conf, { tableName }) => {
  const client = connectTable(conf)

  return {
    ...createStorePutterClient(conf, { tableName, validate, encode }),
    ...createStoreListerClient(conf, { tableName, encodeKey: lister.encodeKey, decode }),

    /**
     * Sum total egress bytes for a space within a time period
     *
     * @param {import('@ucanto/interface').DID} space - The space DID
     * @param {{ from: Date, to: Date }} period - Time period to query
     * @returns {Promise<import('@ucanto/interface').Result<number, Error>>}
     */
    async sumBySpace(space, period) {
      let total = 0
      /** @type {Record<string, import('@aws-sdk/client-dynamodb').AttributeValue> | undefined} */
      let exclusiveStartKey

      try {
        // Query the space GSI to efficiently find all egress events for this space within the time period
        do {
          const queryResult = await client.send(new QueryCommand({
            TableName: tableName,
            IndexName: 'space',
            KeyConditionExpression: 'space = :space AND servedAt BETWEEN :from AND :to',
            ExpressionAttributeValues: {
              ':space': { S: space },
              ':from': { S: period.from.toISOString() },
              ':to': { S: period.to.toISOString() }
            },
            ExclusiveStartKey: exclusiveStartKey
          }))

          if (queryResult.Items) {
            for (const item of queryResult.Items) {
              const record = unmarshall(item)
              total += Number(record.bytes)
            }
          }

          exclusiveStartKey = queryResult.LastEvaluatedKey
        } while (exclusiveStartKey)

        return { ok: total }
      } catch (/** @type {any} */ error) {
        return { error: new Error(`Failed to sum egress by space: ${error.message}`, { cause: error }) }
      }
    }
  }
}