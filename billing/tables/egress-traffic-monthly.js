import { UpdateItemCommand, QueryCommand } from '@aws-sdk/client-dynamodb'
import { unmarshall } from '@aws-sdk/util-dynamodb'
import { connectTable } from './client.js'
import { encode, decode } from '../data/egress-monthly.js'

/**
 * Source of truth for egress traffic monthly aggregates.
 *
 * @type {import('sst/constructs').TableProps}
 */
export const egressTrafficMonthlyTableProps = {
  fields: {
    /** Composite key with format: "customer#{customer-did}" */
    pk: 'string',
    /** Composite key with format: "{YYYY-MM}#{space-did}" */
    sk: 'string',
    /** Space DID (did:key:...) for GSI. */
    space: 'string',
    /** Month in YYYY-MM format for GSI. */
    month: 'string',
    /** Total bytes served (atomic counter). */
    bytes: 'number',
    /** Total number of events (atomic counter). */
    eventCount: 'number',
  },
  primaryIndex: { partitionKey: 'pk', sortKey: 'sk' },
  globalIndexes: {
    'space-month-index': {
      partitionKey: 'space',
      sortKey: 'month',
      projection: ['bytes', 'eventCount']
    }
  }
}

/**
 * @param {{ region: string } | import('@aws-sdk/client-dynamodb').DynamoDBClient} conf
 * @param {{ tableName: string }} context
 * @returns {import('../lib/api.js').EgressTrafficMonthlyStore}
 */
export const createEgressTrafficMonthlyStore = (conf, { tableName }) => {
  const client = connectTable(conf)

  return {
    /**
     * Atomically increment monthly aggregates
     * @param {object} params
     * @param {string} params.customer - Customer DID
     * @param {string} params.space - Space DID
     * @param {string} params.month - YYYY-MM format
     * @param {number} params.bytes - Bytes to add
     */
    async increment({ customer, space, month, bytes }) {
      await client.send(new UpdateItemCommand({
        TableName: tableName,
        Key: {
          pk: { S: `customer#${customer}` },
          sk: { S: `${month}#${space}` }
        },
        UpdateExpression: 'SET space = :space, #month = :month ADD bytes :bytes, eventCount :one',
        ExpressionAttributeNames: {
          '#month': 'month'  // reserved word
        },
        ExpressionAttributeValues: {
          ':space': { S: space },
          ':month': { S: month },
          ':bytes': { N: bytes.toString() },
          ':one': { N: '1' }
        }
      }))
    },

    /**
     * Get total egress for a space in a month (uses GSI)
     * Used by account/usage/get - sumBySpace
     * @param {string} space - Space DID
     * @param {{ from: Date, to: Date }} period - Time period to query
     * @returns {Promise<import('@ucanto/interface').Result<number, Error>>}
     */
    async sumBySpace(space, period) {
      const fromMonth = period.from.toISOString().slice(0, 7)
      const toMonth = period.to.toISOString().slice(0, 7)

      try {
        const result = await client.send(new QueryCommand({
          TableName: tableName,
          IndexName: 'space-month-index',
          KeyConditionExpression: 'space = :space AND #month BETWEEN :from AND :to',
          ExpressionAttributeNames: { '#month': 'month' },
          ExpressionAttributeValues: {
            ':space': { S: space },
            ':from': { S: fromMonth },
            ':to': { S: toMonth }
          }
        }))

        let totalBytes = 0
        for (const item of result.Items ?? []) {
          const record = unmarshall(item)
          totalBytes += Number(record.bytes)
        }

        return { ok: totalBytes }
      } catch (/** @type {any} */ error) {
        return { error: new Error(`Failed to sum egress by space: ${error.message}`, { cause: error }) }
      }
    },

    /**
     * Get all spaces egress for a customer in a month
     * @param {string} customer - Customer DID
     * @param {string} month - YYYY-MM format
     * @returns {Promise<import('@ucanto/interface').Result<Array<{space: string, month: string, bytes: number, eventCount: number}>, Error>>}
     */
    async listByCustomer(customer, month) {
      try {
        const result = await client.send(new QueryCommand({
          TableName: tableName,
          KeyConditionExpression: 'pk = :pk AND begins_with(sk, :month)',
          ExpressionAttributeValues: {
            ':pk': { S: `customer#${customer}` },
            ':month': { S: month }
          }
        }))

        return {
          ok: (result.Items ?? []).map(item => {
            const record = unmarshall(item)
            return {
              space: record.space,
              month: record.month,
              bytes: Number(record.bytes),
              eventCount: Number(record.eventCount)
            }
          })
        }
      } catch (/** @type {any} */ error) {
        return { error: new Error(`Failed to list egress by customer: ${error.message}`, { cause: error }) }
      }
    }
  }
}
