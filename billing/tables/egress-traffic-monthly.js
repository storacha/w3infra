import { UpdateItemCommand, QueryCommand } from '@aws-sdk/client-dynamodb'
import { unmarshall, marshall } from '@aws-sdk/util-dynamodb'
import { connectTable, executeCommand } from './client.js'
import { validate, encode, decode, extractMonth } from '../data/egress-monthly.js'

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
     *
     * @param {object} params
     * @param {string} params.customer - Customer DID
     * @param {string} params.space - Space DID
     * @param {string} params.month - YYYY-MM format
     * @param {number} params.bytes - Bytes to add
     * @param {number} [params.eventCount=1] - Number of events (defaults to 1)
     * @returns {Promise<import('@ucanto/interface').Result<{}, Error>>}
     */
    async increment({ customer, space, month, bytes, eventCount = 1 }) {
      const validation = validate({ customer, space, month, bytes, eventCount })
      if (validation.error) return validation

      const encoding = encode(validation.ok)
      if (encoding.error) return encoding

      const parameters = encoding.ok

      const result = await executeCommand(
        client,
        () => new UpdateItemCommand({
          TableName: tableName,
          Key: marshall({
            pk: parameters.pk,
            sk: parameters.sk
          }),
          UpdateExpression: 'SET #space = :space, #month = :month ADD bytes :bytes, eventCount :one',
          ExpressionAttributeNames: {
            '#space': 'space',  // reserved word
            '#month': 'month'   // reserved word
          },
          ExpressionAttributeValues: marshall({
            ':space': parameters.space,
            ':month': parameters.month,
            ':bytes': parameters.bytes,
            ':one': parameters.eventCount
          })
        }),
        'Failed to increment egress monthly aggregates'
      )

      if (result.error) {
        return { error: new Error(result.error.message, { cause: result.error }) }
      }

      return { ok: {} }
    },
    /**
     * Get total egress for a space in a month (uses GSI)
     * Used by account/usage/get - sumBySpace
     *
     * @param {string} space - Space DID
     * @param {{ from: Date, to: Date }} period - Time period to query
     * @returns {Promise<import('@ucanto/interface').Result<number, Error>>}
     */
    async sumBySpace(space, period) {
      const fromMonth = extractMonth(period.from)
      const toMonth = extractMonth(period.to)

      const result = await executeCommand(
        client,
        () => new QueryCommand({
          TableName: tableName,
          IndexName: 'space-month-index',
          KeyConditionExpression: '#space = :space AND #month BETWEEN :from AND :to',
          ExpressionAttributeNames:  {
            '#space': 'space',  // reserved word
            '#month': 'month'   // reserved word
          },
          ExpressionAttributeValues: marshall({
            ':space': space,
            ':from': fromMonth,
            ':to': toMonth
          })
        }),
        'Failed to sum egress by space'
      )

      if (result.error) {
        return { error: new Error(result.error.message, { cause: result.error }) }
      }

      let totalBytes = 0
      for (const item of result.ok.Items ?? []) {
        const record = unmarshall(item)
        totalBytes += Number(record.bytes)
      }

      return { ok: totalBytes }
    },

    /**
     * Get all spaces egress for a customer in a month with total customer egress
     *
     * @param {string} customer - Customer DID
     * @param {string} month - YYYY-MM format
     * @returns {Promise<import('@ucanto/interface').Result<{spaces: Array<{space: string, month: string, bytes: number, eventCount: number}>, total: number}, Error>>}
     */
    async listByCustomer(customer, month) {
      const result = await executeCommand(
        client,
        () => new QueryCommand({
          TableName: tableName,
          KeyConditionExpression: 'pk = :pk AND begins_with(sk, :month)',
          ExpressionAttributeValues: marshall({
            ':pk': `customer#${customer}`,
            ':month': month
          })
        }),
        'Failed to list egress by customer'
      )

      if (result.error) {
        return result
      }

      let totalBytes = 0
      const spaces = (result.ok.Items ?? []).map(/** @type {(item: import('@aws-sdk/client-dynamodb').AttributeValue) => {space: string, month: string, bytes: number, eventCount: number}} */ (item) => {
        const raw = unmarshall(item)
        const decodedResult = decode( /** @type {import('../lib/api.js').EgressTrafficMonthlySummaryStoreRecord} */(raw))
        
        if (decodedResult.error) throw decodedResult.error
        const record = decodedResult.ok

        totalBytes += record.bytes
        return {
          space: record.space,
          month: record.month,
          bytes: record.bytes,
          eventCount: record.eventCount
        }
      })

      return {
        ok: {
          spaces,
          total: totalBytes
        }
      }
    }
  }
}