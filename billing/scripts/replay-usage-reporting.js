/**
 * Replays usage reporting to Stripe for all usage records with a specific `to` date.
 *
 * This script scans the usage table for records matching the target date and
 * re-runs the reportUsage function for each one.
 *
 * Usage:
 *   node billing/scripts/replay-usage-reporting.js [--customer <did:mailto:...>]
 *
 * Options:
 *   --customer <did>  Only process records for this customer
 *
 * Environment:
 *   STORACHA_ENV - Environment name (e.g., 'prod', 'staging')
 *   STRIPE_SECRET_KEY - Stripe API secret key
 */
import dotenv from 'dotenv'
import { DynamoDBClient, ScanCommand, QueryCommand } from '@aws-sdk/client-dynamodb'
import { unmarshall } from '@aws-sdk/util-dynamodb'
import Stripe from 'stripe'
import { mustGetEnv } from '../../lib/env.js'
import * as Usage from '../data/usage.js'
import { reportUsage } from '../functions/usage-table.js'

dotenv.config({ path: '.env.local' })

const TARGET_TO_DATE = '2026-01-01T00:00:00.000Z'

const args = process.argv.slice(2)
const customerIndex = args.indexOf('--customer')
const CUSTOMER = customerIndex !== -1 ? args[customerIndex + 1] : undefined

const STORACHA_ENV = mustGetEnv('STORACHA_ENV')
const STRIPE_SECRET_KEY = mustGetEnv('STRIPE_SECRET_KEY')
const USAGE_TABLE_NAME = `${STORACHA_ENV}-w3infra-usage`

const dynamo = new DynamoDBClient()
const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: '2025-02-24.acacia' })

/**
 * Queries usage records for a specific customer with the target `to` date.
 *
 * @param {string} customer
 * @returns {AsyncGenerator<import('../lib/api.js').Usage>}
 */
async function* queryUsageRecordsForCustomer(customer) {
  /** @type {Record<string, import('@aws-sdk/client-dynamodb').AttributeValue> | undefined} */
  let lastKey

  do {
    const command = new QueryCommand({
      TableName: USAGE_TABLE_NAME,
      KeyConditionExpression: 'customer = :customer',
      FilterExpression: '#to = :toDate',
      ExpressionAttributeNames: {
        '#to': 'to'
      },
      ExpressionAttributeValues: {
        ':customer': { S: customer },
        ':toDate': { S: TARGET_TO_DATE }
      },
      ExclusiveStartKey: lastKey
    })

    const result = await dynamo.send(command)
    lastKey = result.LastEvaluatedKey

    for (const item of result.Items ?? []) {
      const decoded = Usage.decode(unmarshall(item))
      if (decoded.error) {
        console.error(`Failed to decode usage record:`, decoded.error)
        continue
      }
      yield decoded.ok
    }
  } while (lastKey)
}

/**
 * Scans the usage table for records with the target `to` date.
 *
 * @returns {AsyncGenerator<import('../lib/api.js').Usage>}
 */
async function* scanUsageRecords() {
  /** @type {Record<string, import('@aws-sdk/client-dynamodb').AttributeValue> | undefined} */
  let lastKey

  do {
    const command = new ScanCommand({
      TableName: USAGE_TABLE_NAME,
      FilterExpression: '#to = :toDate',
      ExpressionAttributeNames: {
        '#to': 'to'
      },
      ExpressionAttributeValues: {
        ':toDate': { S: TARGET_TO_DATE }
      },
      ExclusiveStartKey: lastKey
    })

    const result = await dynamo.send(command)
    lastKey = result.LastEvaluatedKey

    for (const item of result.Items ?? []) {
      const decoded = Usage.decode(unmarshall(item))
      if (decoded.error) {
        console.error(`Failed to decode usage record:`, decoded.error)
        continue
      }
      yield decoded.ok
    }
  } while (lastKey)
}

async function main() {
  console.log(`Scanning usage table for records with to=${TARGET_TO_DATE}`)
  console.log(`Table: ${USAGE_TABLE_NAME}`)
  if (CUSTOMER) {
    console.log(`Customer: ${CUSTOMER}`)
  }
  console.log()

  let processed = 0
  let succeeded = 0
  let failed = 0

  const ctx = { stripe }

  const records = CUSTOMER ? queryUsageRecordsForCustomer(CUSTOMER) : scanUsageRecords()
  for await (const usage of records) {
    processed++
    console.log(`\n[${processed}] Processing usage record for space: ${usage.space}`)

    try {
      const result = await reportUsage(usage, ctx)
      if (result.error) {
        console.error(`  ERROR:`, result.error)
        failed++
      } else {
        console.log(`  SUCCESS`)
        succeeded++
      }
    } catch (err) {
      console.error(`  EXCEPTION:`, err)
      failed++
    }
  }

  console.log(`\n========================================`)
  console.log(`Replay complete`)
  console.log(`  Processed: ${processed}`)
  console.log(`  Succeeded: ${succeeded}`)
  console.log(`  Failed: ${failed}`)
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
