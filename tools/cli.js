#!/usr/bin/env node

import sade from 'sade'

import { fetchMetricsForSpaceCmd } from './fetch-metrics-for-space.js'
import { migrateFromD1ToDynamo } from './d1-migration/add-to-dynamo.js'
import { checkD1DynamoMigration } from './d1-migration/check-migration.js'

const cli = sade('w3infra-cli')

cli.version('1.0.0')

cli
  .command('fetch-metrics-for-space', 'Fetch metrics for a given space')
  .action(fetchMetricsForSpaceCmd)

cli
  .command('d1-dynamo-migration', 'Run the D1 -> Dynamo migration')
  .action(migrateFromD1ToDynamo)

cli
  .command('check-d1-dynamo-migration', 'Verify the D1 -> Dynamo migration moved data correctly')
  .action(checkD1DynamoMigration)

cli.parse(process.argv)