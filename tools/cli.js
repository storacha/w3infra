#!/usr/bin/env node

import sade from 'sade'

import { fetchMetricsForSpaceCmd } from './fetch-metrics-for-space.js'
import { followFilecoinReceiptChain } from './follow-filecoin-receipt-chain.js'
import { migrateFromD1ToDynamo } from './d1-migration/add-to-dynamo.js'
import { printD1ProvisionsEmails } from './d1-migration/print-d1-emails.js'
import { verifyD1DynamoMigration } from './d1-migration/verify-d1-dynamo-migration.js'

const cli = sade('w3infra-cli')

cli.version('1.0.0')

cli
  .command('fetch-metrics-for-space', 'Fetch metrics for a given space')
  .action(fetchMetricsForSpaceCmd)

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

cli.parse(process.argv)