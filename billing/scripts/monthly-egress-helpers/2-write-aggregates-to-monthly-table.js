#!/usr/bin/env node

/**
 * Backfill monthly aggregates to egress-traffic-monthly table
 *
 * This script uses ADD operation (increment) to add historical data to the monthly table.
 *
 * IMPORTANT: This is designed for backfilling historical events to a table that's
 * already in production. It ADDS the aggregated values to whatever is already in the table.
 *
 * WARNING: NOT idempotent! Running multiple times will ADD values multiple times.
 * Only run this script ONCE per input file, or use --resume to continue after interruption.
 *
 * Each aggregate in the input JSON is already a complete total for that
 * customer/month/space combination (computed by 1-read-events.js).
 *
 * Supports --resume to skip already-processed keys.
 */

import dotenv from 'dotenv'
import fs from 'node:fs'
import * as CSV from 'csv-stringify/sync'
import pMap from 'p-map'
import { mustGetEnv } from '../../../lib/env.js'
import { createEgressTrafficMonthlyStore } from '../../tables/egress-traffic-monthly.js'

dotenv.config({ path: '.env.local' })

const STORACHA_ENV = mustGetEnv('STORACHA_ENV')
const REGION = mustGetEnv('AWS_REGION')
const EGRESS_TRAFFIC_MONTHLY_TABLE_NAME = `${STORACHA_ENV}-w3infra-egress-traffic-monthly`
const CONCURRENCY = 10

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
 * @param {string} params.inputFile
 * @param {boolean} params.resume
 */
async function writeAggregates({ inputFile, resume }) {
  console.log(`Writing aggregates from: ${inputFile}`)
  console.log(`Environment: ${STORACHA_ENV}`)
  console.log(`Resume: ${resume}\n`)

  // Read input file
  const fileContent = await fs.promises.readFile(inputFile, 'utf8')
  const data = JSON.parse(fileContent)
  const aggregates = data.results

  console.log(`Loaded ${aggregates.length} aggregates from ${data.from} to ${data.to}\n`)

  // State file for resumability
  const stateFile = `${inputFile.replace('.json', '')}-processed.txt`
  const errorFile = `${inputFile.replace('.json', '')}-errors.csv`

  /** @type {Set<string>} */
  let alreadyProcessed = new Set()

  if (resume) {
    try {
      const stateFileContent = await fs.promises.readFile(stateFile, 'utf8')
      alreadyProcessed = new Set(
        stateFileContent.split('\n').map((l) => l.trim()).filter(Boolean)
      )
      console.log(`State file loaded: ${alreadyProcessed.size} already-processed aggregates.\n`)
    } catch (/** @type {any} */ err) {
      if (err.code === 'ENOENT') {
        console.error(`Error: Resume requested but no state file found: ${stateFile}`)
      } else {
        console.error(`Error: Failed to read state file:`, err.message)
      }
      process.exit(1)
    }
  }

  // Filter items to process
  const itemsToProcess = aggregates.filter(
    (/** @type {any} */ agg) => !alreadyProcessed.has(`${agg.customer}#${agg.month}#${agg.space}`)
  )

  console.log(`Processing ${itemsToProcess.length} aggregates (${alreadyProcessed.size} already done)\n`)

  const monthlyStore = createEgressTrafficMonthlyStore(
    { region: REGION },
    { tableName: EGRESS_TRAFFIC_MONTHLY_TABLE_NAME }
  )

  /** @type {string[]} */
  const processedKeys = []
  /** @type {{ key: string, error: string }[]} */
  const errors = []

  let written = 0

  // Flush functions
  function flushOutput() {
    fs.writeFileSync(stateFile, processedKeys.join('\n'))
    console.log(`Wrote ${stateFile}`)
  }

  function flushErrors() {
    if (errors.length > 0) {
      const errorRows = errors.map((e) => [e.key, e.error])
      fs.writeFileSync(
        errorFile,
        CSV.stringify(errorRows, { header: true, columns: ['key', 'error'] })
      )
      console.log(`Wrote ${errorFile}`)
    }
  }

  // Signal handlers
  process.on('SIGINT', () => {
    console.error('\nReceived SIGINT, flushing partial output...')
    console.log(`Processed ${written + errors.length} item(s) so far (success=${written}, errors=${errors.length}). Re-run with --resume to continue.`)
    try {
      flushOutput()
      flushErrors()
    } catch (err) {
      console.error('Error writing files:', err)
    }
    process.exit(1)
  })

  process.on('SIGTERM', () => {
    console.error('\nReceived SIGTERM, flushing partial output...')
    console.log(`Processed ${written + errors.length} item(s) so far (success=${written}, errors=${errors.length}). Re-run with --resume to continue.`)
    try {
      flushOutput()
      flushErrors()
    } catch (err) {
      console.error('Error writing files:', err)
    }
    process.exit(1)
  })

  // Uncaught exception handlers
  process.on('uncaughtException', (err) => {
    console.error('\nUncaught exception occurred:', err)
    console.log(`Processed ${written + errors.length} item(s) so far (success=${written}, errors=${errors.length}). Re-run with --resume to continue.`)
    try {
      flushOutput()
      flushErrors()
    } catch (flushErr) {
      console.error('Error writing files:', flushErr)
    }
    process.exit(1)
  })

  process.on('unhandledRejection', (reason) => {
    console.error('\nUnhandled promise rejection:', reason)
    console.log(`Processed ${written + errors.length} item(s) so far (success=${written}, errors=${errors.length}). Re-run with --resume to continue.`)
    try {
      flushOutput()
      flushErrors()
    } catch (flushErr) {
      console.error('Error writing files:', flushErr)
    }
    process.exit(1)
  })

  // Process aggregates
  await pMap(
    itemsToProcess,
    async (/** @type {any} */ agg) => {
      const key = `${agg.customer}#${agg.month}#${agg.space}`

      try {
        const incrementResult = await monthlyStore.increment({
          customer: agg.customer,
          space: agg.space,
          month: agg.month,
          bytes: agg.bytes,
          eventCount: agg.eventCount
        })

        if (incrementResult.error) {
          throw new Error(incrementResult.error.message)
        }

        processedKeys.push(key)
        written++

        const processed = written + errors.length
        const shouldLog = processed % 100 === 0 ||
                          processed % Math.max(1, Math.floor(itemsToProcess.length / 10)) === 0 ||
                          processed === itemsToProcess.length
        if (shouldLog) {
          console.log(`  [${processed}/${itemsToProcess.length}] success=${written} errors=${errors.length}`)
          logDuration('  Elapsed')
        }

      } catch (/** @type {any} */ err) {
        const message = err instanceof Error ? `${err.name}: ${err.message}` : JSON.stringify(err)
        const processed = written + errors.length + 1  // +1 for current error being logged
        console.error(`  [${processed}/${itemsToProcess.length}] ERROR: ${key} error=${message}`)
        errors.push({ key, error: message })
      }
    },
    { concurrency: CONCURRENCY }
  )

  console.log(`\nWrite complete: ${written + errors.length}/${itemsToProcess.length} processed (success=${written}, errors=${errors.length})\n`)

  // Save state and errors
  await fs.promises.writeFile(stateFile, processedKeys.join('\n'))
  console.log(`Wrote ${stateFile}`)

  if (errors.length > 0) {
    const errorRows = errors.map((e) => [e.key, e.error])
    await fs.promises.writeFile(
      errorFile,
      CSV.stringify(errorRows, { header: true, columns: ['key', 'error'] })
    )
    console.log(`Wrote ${errorFile}`)
  }

  logDuration('Total duration')
}

// CLI parsing
const args = process.argv.slice(2)
const inputArg = args.find((e) => e.startsWith('input='))?.split('input=')[1]
const resumeFlag = args.includes('--resume')

if (!inputArg) {
  console.error('Usage: node 2-write-aggregates.js input=<file.json> [--resume]')
  console.error('Example: node 2-write-aggregates.js input=egress-monthly-aggregates-2024-01-01-2026-02-01.json')
  process.exit(1)
}

if (!fs.existsSync(inputArg)) {
  console.error(`Error: Input file not found: ${inputArg}`)
  process.exit(1)
}

try {
  await writeAggregates({ inputFile: inputArg, resume: resumeFlag })
} catch (/** @type {any} */ err) {
  console.error('Fatal error:', err)
  process.exit(1)
}
