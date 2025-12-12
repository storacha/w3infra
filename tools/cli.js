#!/usr/bin/env node

import sade from 'sade'
import dotenv from 'dotenv'
import { fetchMetricsForSpaceCmd } from './fetch-metrics-for-space.js'
import { followFilecoinReceiptChain } from './follow-filecoin-receipt-chain.js'
import { migrateFromD1ToDynamo } from './d1-migration/add-to-dynamo.js'
import { printD1ProvisionsEmails } from './d1-migration/print-d1-emails.js'
import { verifyD1DynamoMigration } from './d1-migration/verify-d1-dynamo-migration.js'
import { getOldestPiecesPendingDeals } from './get-oldest-pieces-pending-deals.js'
import { reFilecoinSubmitPieces } from './re-filecoin-submit-pieces.js'

dotenv.config({ path: ['.env', '../.env'] })

const cli = sade('w3infra-cli')

cli.version('1.0.0')

cli
  .command('fetch-metrics-for-space', 'Fetch metrics for a given space')
  .action(fetchMetricsForSpaceCmd)

cli
  .command('get-oldest-pieces-pending-deals', 'Get oldest pieces pending deals')
  .action(getOldestPiecesPendingDeals)

cli
  .command('follow-filecoin-receipt-chain', 'Follow filecoin receipt chain for a piece')
  .action(followFilecoinReceiptChain)

cli
  .command('d1-dynamo-migration', 'Run the D1 -> Dynamo migration')
  .action(migrateFromD1ToDynamo)

cli
  .command('print-d1-emails', 'Log emails recorded in D1 provisions table to stdout')
  .action(printD1ProvisionsEmails)

cli
  .command('verify-d1-migration', 'Verify D1 data has migrated successfully to Dynamo')
  .action(verifyD1DynamoMigration)

cli
  .command('re-filecoin-submit-pieces', 'Invoke filecoin/submit on pieces older than a given date')
  .option('--cutoff-date', 'ISO date string (e.g., 2024-01-01T00:00:00Z). Defaults to CUTOFF_DATE env var.')
  .action((opts) => reFilecoinSubmitPieces({ cutoffDate: opts['cutoff-date'] }))

cli.parse(process.argv)
