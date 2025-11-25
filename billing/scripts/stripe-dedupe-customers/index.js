import fs from 'node:fs'
import path from 'node:path'
import dotenv from 'dotenv'
import Stripe from 'stripe'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import pMap from 'p-map'

import { mustGetEnv } from '../../../lib/env.js'
import * as DidMailto from '@storacha/did-mailto'
import { createCustomerStore } from '../../tables/customer.js'

dotenv.config({ path: '.env.local' })

const startMs = Date.now()

// Required env vars
const STRIPE_API_KEY = mustGetEnv('STRIPE_API_KEY')
const STORACHA_ENV = mustGetEnv('STORACHA_ENV')
const CUSTOMER_TABLE_NAME = `${STORACHA_ENV}-w3infra-customer`

/** Concurrency limit */
const MAX_PARALLEL = Number(process.env.DUPE_MAX_PARALLEL || 5)

// Flags
const APPLY_MUTATIONS = process.argv.includes('--apply')
const DRY_RUN = !APPLY_MUTATIONS
const RESUME = process.argv.includes('--resume')
const START_ARG = process.argv.find(a => a.startsWith('--start='))
const START_INDEX = START_ARG ? Number(START_ARG.split('=')[1]) : 0
const CHECKPOINT_ARG = process.argv.find(a => a.startsWith('--checkpoint='))
const CHECKPOINT_FILE = CHECKPOINT_ARG ? CHECKPOINT_ARG.split('=')[1] : 'dedupe-checkpoint.txt'

// Args: node index.js <sigma-duplicates.csv>
const inputCsvPath = process.argv.find(a => a.endsWith('.csv'))
if (!inputCsvPath) {
  throw new Error('Usage: node index.js <sigma-duplicates.csv> [--apply] [--resume] [--start=<n>] [--checkpoint=<file>]')
}

const stripe = new Stripe(STRIPE_API_KEY)
const dynamo = new DynamoDBClient()
const customerStore = createCustomerStore(dynamo, { tableName: CUSTOMER_TABLE_NAME })

/** @param {number} ms */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** Read checkpoint file -> set of processed emails */
/** @param {string} filePath */
function readCheckpoint(filePath) {
  if (!RESUME) return new Set()
  if (!fs.existsSync(filePath)) return new Set()
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/).filter(Boolean)
  return new Set(lines)
}

/**
 * Parse Stripe Sigma CSV assuming fixed column order: email, aggregated_ids, count.
 * We ignore header names and validate by type instead (email contains '@', count is integer, ids parseable list).
 * Supported aggregated_ids formats: {cus_1,cus_2}, [cus_1,cus_2], cus_1,cus_2
 *
 * @param {string} filePath
 * @returns {{ email: string, ids: string[] }[]}
 */
function parseStripeSigmaCsv(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8').trim()
  if (!raw) throw new Error('Empty CSV')
  const lines = raw.split(/\r?\n/).filter(Boolean)
  if (lines.length < 2) throw new Error('Expected header plus data rows')
  // Remove header line; we do not rely on its content.
  lines.shift()
  const rows = []
  for (const line of lines) {
    // Simplify by stripping all double quotes, then match three columns
    const cleaned = line.trim().replace(/"/g, '')
    const match = cleaned.match(/^([^,]+),(.*),(\d+)$/)
    if (!match) {
      // Skip malformed line
      continue
    }
    const email = match[1].trim().toLowerCase()
    const aggRaw = match[2].trim()
    const count = Number(match[3])
    if (!email || !email.includes('@')) continue
    if (!Number.isInteger(count) || count < 2) continue
    // Normalize aggregated IDs list
    let inner = aggRaw
    if ((inner.startsWith('{') && inner.endsWith('}')) || (inner.startsWith('[') && inner.endsWith(']'))) {
      inner = inner.slice(1, -1)
    }
    const ids = inner.split(/\s*,\s*/).filter(Boolean)
    // Basic validation: each id starts with cus_
    const filtered = ids.filter(id => id.startsWith('cus_'))
    if (filtered.length < 2) continue
    // Optional: ensure count matches parsed length (allow mismatch but log)
    if (filtered.length !== count) {
      console.warn(`Count mismatch for email ${email}: declared ${count} parsed ${filtered.length}`)
    }
    rows.push({ email, ids: filtered })
  }
  return rows.filter(r => r.ids.length > 1)
}

/** Get mapped Stripe customer ID for an email via Dynamo (primary key is DID mailto)
 *
 * @param {string} email
 * @returns {Promise<string|null>}
 */
async function getDynamoStripeIdForEmail(email) {
  try {
    const [rawLocal, domain] = email.split('@')
    const encodedLocal = encodeURIComponent(rawLocal)
    const normalizedEmail = `${encodedLocal}@${domain}`
    const did = DidMailto.fromEmail(/** @type {`${string}@${string}`} */(normalizedEmail))
    const res = await customerStore.get({ customer: did })
    if (res.error) return null
    if (res.ok.account) {
      return res.ok.account.replace('stripe:', '')
    }
    return null
  } catch {
    return null
  }
}

/** Fetch Stripe metrics for a customer ID */
/**
 * Customer metrics for deduplication logic.
 *
 * @typedef {object} CustomerMetrics
 * @property {string} id
 * @property {Date|null} created
 * @property {string|null} defaultPaymentMethod
 * @property {number} balance
 * @property {number} activeSubCount
 * @property {number} lifetimePaidTotal
 * @property {number} openOrDraftAmountDue
 */
/**
 * @param {string} customerId
 * @returns {Promise<CustomerMetrics>}
 */
async function fetchStripeCustomersDetails(customerId) {
  /** @type {import('stripe').Stripe.Customer} */
  // @ts-ignore - runtime object conforms to Customer when not deleted
  const customer = await stripe.customers.retrieve(customerId, { expand: ['subscriptions', 'invoice_settings.default_payment_method'] })
  // Active/trialing subscriptions from expanded list
  /** @type {import('stripe').Stripe.Subscription[]|undefined} */
  const subs = /** @type {any} */ (customer.subscriptions)?.data
  const activeSubCount = Array.isArray(subs)
    ? subs.filter(s => s.status === 'active' || s.status === 'trialing').length
    : 0

  // Invoices by status (paid, open, draft) – sum paid totals
  let lifetimePaidTotal = 0
  let openOrDraftAmountDue = 0
  const statuses = ['paid', 'open', 'draft']
  for (const status of statuses) {
    let startingAfter
    do {
      // Cast status to allowed literal union
      // @ts-ignore Stripe type inference for list params union
      const inv = await stripe.invoices.list({ customer: customerId, status, limit: 100, starting_after: startingAfter })
      for (const invoice of inv.data) {
        if (status === 'paid') lifetimePaidTotal += invoice.amount_paid || 0
        else if (status === 'open' || status === 'draft') {
          openOrDraftAmountDue += invoice.amount_due || 0
        }
      }
      startingAfter = inv.has_more ? inv.data[inv.data.length - 1].id : undefined
      if (startingAfter) await sleep(50) // light pacing
    } while (startingAfter)
  }

  return {
    id: customerId,
    created: customer.created ? new Date(customer.created * 1000) : null,
    defaultPaymentMethod: (() => {
      const pm = customer.invoice_settings?.default_payment_method
      if (!pm) return null
      return typeof pm === 'string' ? pm : pm.id || null
    })(),
    balance: customer.balance || 0,
    activeSubCount,
    lifetimePaidTotal,
    openOrDraftAmountDue
  }
}

/** Determine if a customer is zero-footprint (eligible for deletion) */
/**
 * Determine if a customer is zero-footprint (eligible for deletion).
 *
 * @param {CustomerMetrics} metrics
 */
function isZeroFootprint(metrics) {
  return (
    metrics.lifetimePaidTotal === 0 &&
    metrics.balance === 0 &&
    metrics.openOrDraftAmountDue === 0
  )
}

/** Select canonical stripe ID within group */
/**
 * Select canonical stripe ID within group.
 *
 * @param {CustomerMetrics[]} groupMetrics
 * @param {string|null} dynamoStripeId
 * @returns {string}
 */
function selectCanonical(groupMetrics, dynamoStripeId) {
  // 1. If stripe ID is in Dynamo choose it
  if (dynamoStripeId) {
    const mapped = groupMetrics.find(m => m.id === dynamoStripeId)
    if (mapped) return mapped.id
  }
  // 2. Highest lifetime paid total
  const sorted = [...groupMetrics].sort((a, b) => b.lifetimePaidTotal - a.lifetimePaidTotal)
  if (sorted[0].lifetimePaidTotal > 0) return sorted[0].id
  // 3. Has payment method
  const withPM = groupMetrics.find(m => m.defaultPaymentMethod)
  if (withPM) return withPM.id
  // 4. Newest created
  return groupMetrics
    .sort((a, b) => {
      const aTime = a.created instanceof Date ? a.created.getTime() : -Infinity
      const bTime = b.created instanceof Date ? b.created.getTime() : -Infinity
      return bTime - aTime
    })[0].id
}

/** Reason classification for manual review */
/**
 * Reason classification for manual review.
 *
 * @param {CustomerMetrics} metrics
 * @param {string} canonicalId
 * @returns {string|null}
 */
function classifyReason(metrics, canonicalId) {
  if (metrics.id === canonicalId) return null // canonical not reviewed
  if (metrics.lifetimePaidTotal > 0) return 'has_paid_invoices'
  if (metrics.openOrDraftAmountDue > 0) return 'has_open_or_draft_non_zero_invoices'
  if (metrics.balance !== 0) return 'has_non_zero_balance'
  // If zero footprint we will auto delete (no manual reason)
  return null
}

/**
 * @param {{ email: string, ids: string[] }} group
 */
async function processGroup(group) {
  const dynamoStripeId = await getDynamoStripeIdForEmail(group.email)
  const stripeCustomers = await pMap(group.ids, (id) => fetchStripeCustomersDetails(id), { concurrency: MAX_PARALLEL })
  const canonicalId = selectCanonical(stripeCustomers, dynamoStripeId)
  const deletions = []
  const manual = []
  for (const customer of stripeCustomers) {
    if (customer.id === canonicalId) continue
    const reason = classifyReason(customer, canonicalId)
    if (!reason && isZeroFootprint(customer)) {
      deletions.push(customer)
    } else if (reason) {
      manual.push({ reason, canonicalId, metrics: customer })
    } else {
      manual.push({ reason: 'unknown_state', canonicalId, metrics: customer })
    }
  }
  return { canonicalId, deletions, manual }
}

/** Build Stripe dashboard URL for a customer id.
 *
 * @param {string} id
 * @returns {string}
 */
function stripeCustomerUrl(id) {
  const isTest = /_test_/.test(STRIPE_API_KEY)
  return `https://dashboard.stripe.com/acct_1LO87hF6A5ufQX5v/${isTest ? 'test/' : ''}customers/${id}`
}

/** Write manual review CSV.
 *
 * @param {{ email: string, canonicalId: string, reason: string, metrics: CustomerMetrics }[]} rows
 */
function writeManualCsv(rows) {
  const header = [
    'email',
    'canonical_customer_id',
    'canonical_customer_url',
    'other_customer_id',
    'other_customer_url',
    'reason',
    'active_subscriptions',
    'lifetime_paid_total',
    'open_or_draft_invoices',
    'balance',
    'default_payment_method',
    'created'
  ]
  const lines = [header.join(',')]
  for (const r of rows) {
    const m = r.metrics
    lines.push([
      r.email,
      r.canonicalId,
      stripeCustomerUrl(r.canonicalId),
      m.id,
      stripeCustomerUrl(m.id),
      r.reason,
      m.activeSubCount,
      m.lifetimePaidTotal,
      m.openOrDraftAmountDue,
      m.balance,
      m.defaultPaymentMethod || '',
      (m.created ? m.created.toISOString() : '')
    ].join(','))
  }
  const outPath = path.resolve(process.cwd(), 'manual-review.csv')
  fs.writeFileSync(outPath, lines.join('\n'))
  console.log(`\nManual review CSV written: ${outPath} (${rows.length} rows)`) 
}

/**
 * @param {string} id
 */
async function deleteStripeCustomer(id) {
  if (DRY_RUN) {
    console.log(`\t [dry-run] Would delete customer ${id}`)
    return
  }
  try {
    const res = await stripe.customers.del(id)
    console.log(`\t Deleted customer ${id} (${res.deleted ? 'ok' : 'not confirmed'})`)
  } catch (err) {
    console.error(`\t Error deleting customer ${id}:`, err instanceof Error ? err.message : String(err))
  }
}

 /** Accumulators & state */
/** @type {{ email: string, canonicalId: string, reason: string, metrics: CustomerMetrics }[]} */
const manualRows = []
let autoDeleteCount = 0
let skippedCount = 0
let processedCount = 0
const processedThisRun = new Set()
let globalProcessedEmails = new Set()

export async function main() {
  console.log(`Starting duplicate customer processing. Dry-run: ${DRY_RUN}`)
  const csvPath = /** @type {string} */ (inputCsvPath)
  const emailGroups = parseStripeSigmaCsv(csvPath)
  console.log(`Loaded ${emailGroups.length} duplicate email groups from ${inputCsvPath}`)
  const processedEmails = readCheckpoint(CHECKPOINT_FILE)
  globalProcessedEmails = processedEmails
  if (RESUME) console.log(`Resume mode: loaded ${processedEmails.size} emails from ${CHECKPOINT_FILE}`)
  if (START_INDEX > 0) console.log(`Starting at group index: ${START_INDEX}`)

  const totalGroups = emailGroups.length

  try {
    for (let i = START_INDEX; i < totalGroups; i++) {
      const group = emailGroups[i]
      if (processedEmails.has(group.email)) {
        skippedCount++
        continue
      }
      console.log(`\n[${i + 1}/${totalGroups}] ${group.email} (${group.ids.length} ids)`) 
      const { canonicalId, deletions, manual } = await processGroup(group)
      console.log(`\t Canonical chosen: ${canonicalId}`)
      for (const d of deletions) {
        console.log(`\t Auto-delete candidate: ${d.id}`)
        await deleteStripeCustomer(d.id)
        autoDeleteCount++
        await sleep(40)
      }
      for (const m of manual) {
        manualRows.push({
          email: group.email,
          canonicalId,
          reason: m.reason,
          metrics: m.metrics
        })
      }
      processedCount++
      processedThisRun.add(group.email)
      console.log(`\nProgress: processed=${processedCount} skipped=${skippedCount} autoDeleted=${autoDeleteCount} manualRows=${manualRows.length}`)
    }
  } catch (err) {
    console.error('Error during processing loop:', err)
    flushOnFailure('error', manualRows, processedThisRun, processedEmails)
    throw err
  }

  // Successful completion: write manual CSV, but DO NOT update checkpoint (only on interruption/error)
  writeManualCsv(manualRows)
  console.log(`\nSummary: total=${totalGroups} processed=${processedCount} skipped=${skippedCount} auto-deleted=${autoDeleteCount} manual-rows=${manualRows.length}`)

  logDuration('Duration')
  console.log('Checkpoint not updated (only written on error or interruption).')
  if (DRY_RUN) console.log('Dry-run mode: no Stripe deletions were performed. Re-run with --apply to enact deletions.')
}

function logDuration(label = 'Duration') {
  const elapsedMs = Date.now() - startMs
  const hours = Math.floor(elapsedMs / 3600000)
  const minutes = Math.floor((elapsedMs % 3600000) / 60000)
  const seconds = Math.floor((elapsedMs % 60000) / 1000)
  const formatted = `${String(hours).padStart(2,'0')}:${String(minutes).padStart(2,'0')}:${String(seconds).padStart(2,'0')}`
  console.log(`${label}: ${formatted}`)
}

/** 
 * @param {string} reason 
 * @param {{ email: string, canonicalId: string, reason: string, metrics: CustomerMetrics }[]} manualRows
 * @param {Set<string>} processedThisRun
 * @param {Set<string>} processedEmails
 */
function flushOnFailure(reason, manualRows, processedThisRun, processedEmails) {
  try {
    if (manualRows.length) {
      writeManualCsv(manualRows)
      console.error(`Partial manual CSV written after ${reason}. Rows: ${manualRows.length}`)
    }
    if (processedThisRun.size) {
      const all = new Set([...processedEmails, ...processedThisRun])
      fs.writeFileSync(CHECKPOINT_FILE, [...all].join('\n') + '\n')
      console.error(`Checkpoint updated (${all.size} emails) after ${reason}: ${CHECKPOINT_FILE}`)
    }
  } catch (err) {
    console.error('Error flushing state:', err)
  }
  logDuration('Interrupted after')
}

process.on('SIGINT', () => {
  console.error('\nReceived SIGINT, flushing partial state...')
  flushOnFailure('SIGINT', manualRows, processedThisRun, globalProcessedEmails)
  throw new Error('Process interrupted by SIGINT')
})
process.on('SIGTERM', () => {
  console.error('\nReceived SIGTERM, flushing partial state...')
  flushOnFailure('SIGTERM', manualRows, processedThisRun, globalProcessedEmails)
  throw new Error('Process interrupted by SIGTERM')
})

try {
  await main()
} catch (e) {
  console.error(e)
  logDuration('Error after')
  throw e
}