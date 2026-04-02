import dotenv from 'dotenv'
import fs from 'node:fs'
import Stripe from 'stripe'
import pMap from 'p-map'
import * as CSV from 'csv-stringify/sync'
import parse from 'csv-parser'
import { mustGetEnv } from '../../../lib/env.js'

dotenv.config({ path: '.env.local' })

const STORACHA_ENV = mustGetEnv('STORACHA_ENV')
const STRIPE_API_KEY = mustGetEnv('STRIPE_API_KEY')

const stripe = new Stripe(STRIPE_API_KEY)

const CONCURRENCY = 5
const ERROR_FILE = 'remove-lines-errors.csv'
const REPORT_FILE = 'remove-lines-report.csv'

const EXPECTED_PERIOD_START_DATE = '2026-03-01'
const EXPECTED_PERIOD_END_DATE = '2026-04-01'
const PRICE_ID_TO_PLAN = /** @type {Record<string, string>} */ ({
  'price_1SUtvLF6A5ufQX5vjHMdUcHh': 'Extra Spicy Tier',
  'price_1SUtvAF6A5ufQX5vM1Dc3Kpl': 'Medium Tier',
})

const TARGET_PRICE_IDS = new Set(Object.keys(PRICE_ID_TO_PLAN))

const startMs = Date.now()

const args = process.argv.slice(2)
const csvFile = args.find((a) => !a.startsWith('--'))

if (!csvFile) {
  console.error('Usage: node index.js <input.csv>')
  console.error('CSV must have an "invoice_id" column.')
  process.exit(1)
}

const inputFile = /** @type {string} */ (csvFile)

/** @type {{ identifier: string, error: string }[]} */
const errors = []

/**
 * @typedef {{ customerId: string, priceId: string, planName: string, totalBefore: number, discountAmount: number, totalAfter: number }} ReportRow
 */
/** @type {ReportRow[]} */
const report = []

async function main() {
  console.log(`\nRemoving target line items from draft invoices (env: ${STORACHA_ENV})`)
  console.log(`Target prices: ${[...TARGET_PRICE_IDS].join(', ')}`)
  console.log(`Expected period: ${EXPECTED_PERIOD_START_DATE} → ${EXPECTED_PERIOD_END_DATE}`)
  console.log(`Input CSV: ${inputFile}\n`)

  const invoiceIds = await readInvoiceIds(inputFile)
  console.log(`Loaded ${invoiceIds.length} invoice ID(s) from CSV\n`)

  const total = invoiceIds.length
  let processedCount = 0
  let successCount = 0
  let skippedCount = 0
  let failedCount = 0

  await pMap(invoiceIds, async (invoiceId) => {
    processedCount++

    try {
      const invoice = await stripe.invoices.retrieve(invoiceId, {
        expand: ['lines.data.price.product'],
      })

      // Validate draft status
      if (invoice.status !== 'draft') {
        console.log(`  [${processedCount}/${total}] Skipped: invoice=${invoiceId} status=${invoice.status} (not draft)`)
        skippedCount++
        return
      }

      // Validate period_end is March 31 and period_start is February 28
      const periodEndDate = new Date(invoice.period_end * 1000).toISOString().slice(0, 10)
      const periodStartDate = new Date(invoice.period_start * 1000).toISOString().slice(0, 10)

      if (periodEndDate !== EXPECTED_PERIOD_END_DATE || periodStartDate !== EXPECTED_PERIOD_START_DATE) {
        console.log(`  [${processedCount}/${total}] Skipped: invoice=${invoiceId} period=${periodStartDate}→${periodEndDate} (expected ${EXPECTED_PERIOD_START_DATE}→${EXPECTED_PERIOD_END_DATE})`)
        skippedCount++
        return
      }

      // Find the first line item matching price ID, period +1 month from invoice period, and positive amount
      const lineItemPeriodStart = addOneMonth(EXPECTED_PERIOD_START_DATE)
      const lineItemPeriodEnd = addOneMonth(EXPECTED_PERIOD_END_DATE)
      const matchingLine = invoice.lines?.data.find((line) => {
        if (!line.price || !TARGET_PRICE_IDS.has(line.price.id)) return false
        if (line.amount <= 0) return false
        const periodStart = new Date(line.period.start * 1000).toISOString().slice(0, 10)
        const periodEnd = new Date(line.period.end * 1000).toISOString().slice(0, 10)
        return periodStart === lineItemPeriodStart && periodEnd === lineItemPeriodEnd
      })

      if (!matchingLine) {
        console.log(`  [${processedCount}/${total}] Skipped: invoice=${invoiceId} no matching line items`)
        skippedCount++
        return
      }

      const customerId = typeof invoice.customer === 'string'
        ? invoice.customer
        : invoice.customer?.id || 'unknown'

      const totalBefore = invoice.amount_due
      const discountAmount = -matchingLine.amount

      // Add a credit item offsetting the base fee
      const discount = {
        customer: customerId,
        invoice: invoiceId,
        amount: discountAmount,
        currency: matchingLine.currency,
        description: 'Credit: no charge for April base fee',
        tax_behavior: matchingLine.price?.tax_behavior ?? 'unspecified',
      }
      await stripe.invoiceItems.create(discount)

      const priceId = matchingLine.price?.id || 'unknown'
      const planName = PRICE_ID_TO_PLAN[priceId]

      report.push({
        customerId,
        priceId,
        planName,
        totalBefore,
        discountAmount,
        totalAfter: totalBefore + discountAmount,
      })

      console.log(`  [${processedCount}/${total}] Credited: invoice=${invoiceId} customer=${customerId} amount=${discountAmount}`)
      successCount++
    } catch (/** @type {any} */ err) {
      const message = err instanceof Error ? err.message : JSON.stringify(err) || 'Unknown error'
      console.error(`  [${processedCount}/${total}] ERROR: invoice=${invoiceId} error=${message}`)
      errors.push({ identifier: invoiceId, error: message })
      failedCount++
    }

    const shouldLog = processedCount % 100 === 0 ||
      processedCount % Math.max(1, Math.floor(total / 10)) === 0
    if (shouldLog || processedCount === total) {
      console.log(`  [${processedCount}/${total}] Summary: Success=${successCount}, Skipped=${skippedCount}, Failed=${failedCount}`)
      logDuration('Elapsed')
    }
  }, { concurrency: CONCURRENCY })

  console.log(`\nComplete. Success=${successCount}, Skipped=${skippedCount}, Failed=${failedCount}`)
  logDuration('Total duration')

  flushReport()
  flushErrors()
}

/**
 * @param {string} filePath
 * @returns {Promise<string[]>}
 */
async function readInvoiceIds(filePath) {
  /** @type {string[]} */
  const ids = []
  return new Promise((resolve, reject) => {
    fs.createReadStream(filePath)
      .pipe(parse())
      .on('data', (/** @type {Record<string, string>} */ row) => {
        const id = row['invoice_id']?.trim()
        if (id) ids.push(id)
      })
      .on('end', () => resolve(ids))
      .on('error', reject)
  })
}

/** @param {string} [label] */
function logDuration(label = 'Duration') {
  const elapsedMs = Date.now() - startMs
  const hours = Math.floor(elapsedMs / 3600000)
  const minutes = Math.floor((elapsedMs % 3600000) / 60000)
  const seconds = Math.floor((elapsedMs % 60000) / 1000)
  const formatted = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
  console.log(`${label}: ${formatted}`)
}

function flushErrors() {
  if (errors.length > 0) {
    const csvContent = CSV.stringify(
      errors.map((e) => [e.identifier, e.error]),
      { header: true, columns: ['identifier', 'error'] }
    )
    fs.writeFileSync(ERROR_FILE, csvContent)
    console.log(`Wrote ${ERROR_FILE} (${errors.length} errors)`)
  }
}

/**
 * Adds one month to a yyyy-mm-dd date string.
 * @param {string} dateStr
 * @returns {string}
 */
function addOneMonth(dateStr) {
  const d = new Date(dateStr + 'T00:00:00Z')
  d.setUTCMonth(d.getUTCMonth() + 1)
  return d.toISOString().slice(0, 10)
}

function flushReport() {
  if (report.length > 0) {
    const csvContent = CSV.stringify(
      report.map((r) => [r.customerId, r.planName, r.priceId, r.totalBefore, r.discountAmount, r.totalAfter]),
      {
        header: true,
        columns: ['customer_id', 'plan_name', 'price_id', 'total_before', 'discount_amount', 'total_after'],
      }
    )
    fs.writeFileSync(REPORT_FILE, csvContent)
    console.log(`Wrote ${REPORT_FILE} (${report.length} rows)`)
  }
}

process.on('SIGINT', () => {
  console.error('\nReceived SIGINT, flushing output...')
  try { flushReport() } catch (err) { console.error('Error writing report:', err) }
  try { flushErrors() } catch (err) { console.error('Error writing errors:', err) }
  process.exit(1)
})

process.on('SIGTERM', () => {
  console.error('\nReceived SIGTERM, flushing output...')
  try { flushReport() } catch (err) { console.error('Error writing report:', err) }
  try { flushErrors() } catch (err) { console.error('Error writing errors:', err) }
  process.exit(1)
})

try {
  await main()
} catch (err) {
  console.error('Fatal error:', err)
  flushReport()
  flushErrors()
  process.exit(1)
}