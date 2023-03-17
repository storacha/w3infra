#!/usr/bin/env node

import sade from 'sade'

import { fetchMetricsForSpaceCmd } from './fetch-metrics-for-space.js'

const cli = sade('w3infra-cli')

cli.version('1.0.0')

cli
  .command('fetch-metrics-for-space', 'Fetch metrics for a given space')
  .action(fetchMetricsForSpaceCmd)

cli.parse(process.argv)