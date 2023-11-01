#!/usr/bin/env node
import fs from 'node:fs'
import sade from 'sade'
import dotenv from 'dotenv'
import { spaceAdd } from './src/space.js'
import { diffAdd, diffRemove} from './src/diff.js'
import { customerAdd } from './src/customer.js'
import { billingRun } from './src/run.js'
import { usageGet } from './src/usage.js'
import { snapshotCreate } from './src/snapshot.js'

const pkg = JSON.parse(fs.readFileSync(new URL('package.json', import.meta.url)).toString())

dotenv.config({ path: './.env.local' })

sade('billing')
  .version(pkg.version)

  .command('customer add <customer> <account>')
  .describe('Add a customer to the billing system. `customer` is a did:mailto: address and `account` is a Stripe customer ID.')
  .action(customerAdd)

  .command('space add <customer>')
  .describe('Add a space for the customer to the billing system.')
  .action(spaceAdd)

  .command('snapshot create <space> <datetime>')
  .describe('Create a snapshot of the space size at the given timestamp.')
  .option('-w, --write', 'Write snapshot to the store.', false)
  .action(snapshotCreate)

  .command('diff add <space> <bytes> <datetime>')
  .describe('Add some bytes to the space at the passed ISO timestamp.')
  .action(diffAdd)

  .command('diff remove <space> <bytes> <datetime>')
  .describe('Remove some bytes from the space at the passed ISO timestamp.')
  .action(diffRemove)

  .command('run <from> <to>')
  .describe('Trigger a billing run for the passed period.')
  .action(billingRun)

  .command('usage <customer> <from> <to>')
  .describe('Get usage for customer for period.')
  .action(usageGet)

  .parse(process.argv)
