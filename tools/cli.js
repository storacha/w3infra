#!/usr/bin/env node
import sade from 'sade'
import { fetchMetricsForSpaceCmd } from './fetch-metrics-for-space.js'
import { followFilecoinReceiptChain } from './follow-filecoin-receipt-chain.js'
import { getOldestPiecesPendingDeals } from './get-oldest-pieces-pending-deals.js'

const cli = sade('upload-service-infra-cli')

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

cli.parse(process.argv)
