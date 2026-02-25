#!/usr/bin/env node

/**
 * Read egress events and generate monthly aggregates file
 *
 * This script is READ-ONLY and safe to re-run multiple times.
 * Generates: egress-monthly-aggregates-{from}-{to}.json
 */

import dotenv from 'dotenv'
import { DynamoDBClient, ScanCommand } from '@aws-sdk/client-dynamodb'
import { unmarshall } from '@aws-sdk/util-dynamodb'
import fs from 'node:fs'
import { mustGetEnv } from '../../../lib/env.js'
import { extractMonth } from '../../data/egress-monthly.js'

dotenv.config({ path: '.env.local' })

const STORACHA_ENV = mustGetEnv('STORACHA_ENV')

// Timing
const startMs = Date.now()
/** @param {string} [label] */
function logDuration(label = 'Duration') {
  const elapsedMs = Date.now() - startMs
  const hours = Math.floor(elapsedMs / 3600000)
  const minutes = Math.floor((elapsedMs % 3600000) / 60000)
  const seconds = Math.floor((elapsedMs % 60000) / 1000)
  const formatted = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
  console.log(`${label}: ${formatted}`)
}

/**
 * @param {object} params
 * @param {string} params.fromDate
 * @param {string} params.toDate
 */
async function readEvents({ fromDate, toDate }) {
  console.log(`Reading egress events: ${fromDate} to ${toDate}`)
  console.log(`Environment: ${STORACHA_ENV}\n`)

  const region = mustGetEnv('AWS_REGION')
  const client = new DynamoDBClient({ region })
  const tableName = mustGetEnv('EGRESS_TRAFFIC_TABLE_NAME')

  // Aggregate in memory by customer+space+month
  /** @type {Map<string, { customer: string, space: string, month: string, bytes: bigint, eventCount: number }>} */
  const aggregates = new Map()

  let scanned = 0
  let exclusiveStartKey = undefined

  do {
    const result = await client.send(new ScanCommand({
      TableName: tableName,
      ExclusiveStartKey: exclusiveStartKey,
      FilterExpression: 'servedAt BETWEEN :from AND :to',
      ExpressionAttributeValues: {
        ':from': { S: fromDate },
        ':to': { S: toDate }
      }
    }))

    for (const rawItem of result.Items ?? []) {
      const item = unmarshall(rawItem)
      const month = extractMonth(new Date(item.servedAt))
      const key = `${item.customer}#${month}#${item.space}`

      const existing = aggregates.get(key) ?? { bytes: 0n, eventCount: 0 }
      aggregates.set(key, {
        customer: item.customer,
        space: item.space,
        month,
        bytes: existing.bytes + BigInt(item.bytes),
        eventCount: existing.eventCount + 1
      })

      scanned++
      if (scanned % 10000 === 0) {
        console.log(`  Scanned: ${scanned} events → ${aggregates.size} unique aggregates`)
        logDuration('  Elapsed')
      }
    }

    exclusiveStartKey = result.LastEvaluatedKey
  } while (exclusiveStartKey)

  console.log(`\nScan complete: ${scanned} events → ${aggregates.size} aggregates\n`)

  // Convert to array for JSON serialization
  const results = [...aggregates.values()].map(agg => ({
    customer: agg.customer,
    space: agg.space,
    month: agg.month,
    bytes: agg.bytes.toString(), // BigInt as string
    eventCount: agg.eventCount
  }))

  // Write JSON output
  const jsonFile = `egress-monthly-aggregates-${fromDate}-${toDate}.json`
  const jsonOutput = {
    generatedAt: new Date().toISOString(),
    env: STORACHA_ENV,
    from: fromDate,
    to: toDate,
    totalEvents: scanned,
    totalAggregates: results.length,
    results
  }

  await fs.promises.writeFile(jsonFile, JSON.stringify(jsonOutput, null, 2))
  console.log(`Wrote ${jsonFile}`)
  logDuration('Total duration')
}

// CLI parsing
const args = process.argv.slice(2)
const fromArg = args.find((e) => e.startsWith('from='))?.split('from=')[1]
const toArg = args.find((e) => e.startsWith('to='))?.split('to=')[1]

if (!fromArg || !toArg) {
  console.error('Usage: node 1-read-events.js from=yyyy-mm-dd to=yyyy-mm-dd')
  console.error('Example: node 1-read-events.js from=2024-01-01 to=2026-02-01')
  process.exit(1)
}

if (!/^\d{4}-\d{2}-\d{2}$/.test(fromArg)) {
  console.error(`Error: Invalid date format '${fromArg}'. Expected yyyy-mm-dd.`)
  process.exit(1)
}

if (!/^\d{4}-\d{2}-\d{2}$/.test(toArg)) {
  console.error(`Error: Invalid date format '${toArg}'. Expected yyyy-mm-dd.`)
  process.exit(1)
}

readEvents({ fromDate: fromArg, toDate: toArg }).catch((/** @type {any} */ err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
