#!/usr/bin/env node
import fs from 'node:fs'
import sade from 'sade'
import dotenv from 'dotenv'
import { addCustomer } from './src/customer.js'
import { runBilling } from './src/run.js'
import { diffAdd, diffRemove} from './src/diff.js'

const pkg = JSON.parse(fs.readFileSync(new URL('package.json', import.meta.url)).toString())

dotenv.config({ path: './.env' })

const cli = sade('billing')

cli
  .version(pkg.version)

cli
  .command('customer add <customer> <account>')
  .describe('Add a customer to the billing system. `customer` is a did:mailto: address and `account` is a Stripe customer ID.')
  .action(addCustomer)

cli
  .command('space add <customer>')
  .describe('Add a space for the customer to the billing system.')
  .action(async (/** @type {Record<string, string|undefined>} */ options) => {
  })

cli
  .command('diff add <space> <bytes> <datetime>')
  .describe('Add some bytes to the space at the passed ISO timestamp.')
  .action(diffAdd)

cli
  .command('diff remove <space> <bytes> <datetime>')
  .describe('Remove some bytes from the space at the passed ISO timestamp.')
  .action(diffRemove)

cli
  .command('run <from> <to>')
  .describe('Trigger a billing run for the passed period.')
  .action(runBilling)

cli
  .command('usage <customer> <datetime>')
  .describe('.')
  .option('-e, --endpoint', 'Bucket endpoint.')
  .action(async (/** @type {Record<string, string|undefined>} */ options) => {
  })

cli.parse(process.argv)
