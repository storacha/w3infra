import pMap from 'p-map'
import Big from 'big.js'
import fs from 'node:fs'
import path from 'node:path'
import dotenv from 'dotenv'
import Stripe from 'stripe'
import { DynamoDBClient, QueryCommand } from '@aws-sdk/client-dynamodb'
import { unmarshall } from '@aws-sdk/util-dynamodb'
import * as DidMailto from '@storacha/did-mailto'
import { mustGetEnv } from '../../../lib/env.js'
import { createCustomerStore } from '../../tables/customer.js'
import { decode } from '../../data/usage.js'
import { StoreOperationFailure } from '../../tables/lib.js'
import {
  oldPriceIds,
  oldPricesNames,
} from '../schedule-stripe-migration/prices-config.js'

dotenv.config({ path: '.env.local' })

// Required env vars
const STRIPE_API_KEY = mustGetEnv('STRIPE_API_KEY')
const STORACHA_ENV = /** @type {'prod' | 'staging'} */ (
  mustGetEnv('STORACHA_ENV')
)
const CUSTOMER_TABLE_NAME = `${STORACHA_ENV}-w3infra-customer`
const USAGE_TABLE_NAME = `${STORACHA_ENV}-w3infra-usage`

const MAX_PARALLEL = Number(process.env.DUPE_MAX_PARALLEL || 5)

const stripe = new Stripe(STRIPE_API_KEY)
const dynamo = new DynamoDBClient()
const customerStore = createCustomerStore(dynamo, {
  tableName: CUSTOMER_TABLE_NAME,
})

const fromStr = '2025-11-01'
const to = new Date(Date.parse('2025-12-01'))
const from = new Date(Date.parse(fromStr))

const CURSOR_ARG = process.argv.find(a => a.startsWith('--cursor='))
let cursor = CURSOR_ARG ? CURSOR_ARG.split('=')[1] : undefined

const PRICE_ID_ARG = process.argv.find((a) => a.startsWith('--priceId='))
const singlePriceId = PRICE_ID_ARG ? PRICE_ID_ARG.split('=')[1] : null

const priceIdsToProcess = singlePriceId
  ? [singlePriceId]
  : oldPriceIds[STORACHA_ENV]

export const productOveragesPrices = {
  STARTER: {
    maxBytes: 5_368_709_120,
    costPerByte: 0.0000000001397,
  },
  LITE: {
    maxBytes: 107_374_182_400,
    costPerByte: 0.00000000004656,
  },
  BUSINESS: {
    maxBytes: 2_147_483_648_000,
    costPerByte: 0.00000000002793,
  },
}

/**
 * Manual Attention Record
 *
 * @typedef {object} ManualAttentionRecord
 * @property {`${string}@${string}`} customerEmail
 * @property {string|undefined} plan
 * @property {string|undefined} stripeCustomerId
 * @property {string|undefined} subscriptionStatus
 * @property {string|undefined} totalUsage
 * @property {string|undefined} byteQuantity
 * @property {string|undefined} overageCharge
 * @property {string|undefined} invoiceId
 * @property {`did:mailto:${string}`} customerDid
 * @property {string} reason
 */
/** @type {ManualAttentionRecord[]} */
const manualAttention = []

const startMs = Date.now()

async function main() {

  let batchNum = 0
  while (true) {
    batchNum++
    const customerList = await customerStore.list({}, { cursor, size: 1000 })
    if (customerList.error) return customerList

    await pMap(customerList.ok.results, async (c) => {
      const customerDid = c.customer
      const customerEmail = DidMailto.toEmail(/** @type {`did:mailto:${string}:${string}`} */ (c.customer))

      /** @type {ManualAttentionRecord} */
      const context = {
        customerEmail,
        customerDid,
        reason: '',
      }

      if (!c.account) {
        console.log(`[${c.customer}] No account associated, skipping.`)
        manualAttention.push({
          ...context,
          reason: 'No stripe account associated',
        })
        return
      }

      const stripeCustomerId = c.account.replace('stripe:', '')
      context.stripeCustomerId = stripeCustomerId

      ///////////////////////////// GET TOTAL USAGE ///////////////////////////// 

      const usageRecords = await usageStoreList(c.customer, fromStr)
      if (usageRecords.error) {
        manualAttention.push({
          ...context,
          reason: `Failed to list usage records: ${usageRecords.error.message}`,
        })
        return
      }

      const totalUsage = usageRecords.ok.reduce((acc, rec) => {
        return acc + rec.usage
      }, 0n)

      const duration = to.getTime() - from.getTime()
      const byteQuantity = Math.floor(new Big(totalUsage.toString()).div(duration).toNumber())
      context.totalUsage = totalUsage.toString()
      context.byteQuantity = byteQuantity.toString()
        
      ///////////////////////////// GET RELATED INVOICE ///////////////////////////// 

      const invoices = await stripe.invoices.list({
        customer: stripeCustomerId,
        status: 'draft',
        limit: 30,
        expand: ['data.subscription', 'data.lines.data.price'],
      })

      const invoiceWithOldPrice = invoices.data.find((inv) =>
        inv.lines.data.some(
        (line) => line.price && priceIdsToProcess.includes(line.price.id)
        )
      )

      if (!invoiceWithOldPrice) {
        console.log(`[${customerDid}] No draft invoice with old price found!`)
        manualAttention.push({
          ...context,
          reason: `No draft invoice with old price found`,
        })
        return
      }

      const taxBehavior = invoiceWithOldPrice?.lines.data[0].price?.tax_behavior || 'unspecified'
      const planPriceId = /** @type {string} */ (invoiceWithOldPrice?.lines.data[0].price?.id)

      context.plan = oldPricesNames[planPriceId]
      context.invoiceId = invoiceWithOldPrice?.id

      ///////////////////////////// CALCULATE OVERAGES ///////////////////////////// 

      const overagesValue = getOveragesValue(oldPricesNames[planPriceId], byteQuantity)

      if (overagesValue === 0) {
        console.log(`[${customerDid}] No overages found`)
        return
      }

      const overagesCents = Math.round(overagesValue * 100)
      context.overageCharge = overagesValue.toFixed(2)

      // UPDATE INVOICE

      try {
        const overages = await stripe.invoiceItems.create({
          customer: stripeCustomerId,
          invoice: invoiceWithOldPrice?.id,
          amount: overagesCents,
          currency: invoiceWithOldPrice?.currency,
          description: 'Storage overages',
          tax_behavior: taxBehavior,
        })
        console.log(`[${customerDid}] Created invoice item for overages:`, overages.id)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        manualAttention.push({
          ...context,
          reason: `Failed to create invoice item for overages: ${message}`,
        })
        return
      }

      console.log( `[${customerDid}] Processed invoice ${invoiceWithOldPrice.id} for plan ${oldPricesNames[planPriceId]} with total usage ${totalUsage.toString()} (${byteQuantity} bytes) and overages $${overagesValue.toFixed(2)}`)
    }, { concurrency: MAX_PARALLEL })

    logDuration('Batch duration')
    writeManualAttentionCsv(manualAttention)
    console.log(`Batch ${batchNum} complete.`)

    if (!customerList.ok.cursor) break
    cursor = customerList.ok.cursor
  }
  console.log('All batches complete.')
  logDuration('Total duration') 
}

/**
 *
 * @param {string} customerDid
 * @param {string} from
 */
async function usageStoreList(customerDid, from) {
  const params = {
    TableName: USAGE_TABLE_NAME,
    KeyConditionExpression: 'customer = :customer AND begins_with(sk, :date)',
    ExpressionAttributeValues: {
      ':customer': { S: customerDid },
      ':date': { S: from },
    },
  }

  let res
  try {
    res = await dynamo.send(new QueryCommand(params))

    if (res.$metadata.httpStatusCode !== 200) {
      throw new Error(
        `unexpected status listing table content: ${res.$metadata.httpStatusCode}`
      )
    }
  } catch (/** @type {any} */ err) {
    console.error(`Failed to list usage records for ${customerDid}`, err)
    return { error: new StoreOperationFailure(err.message, { cause: err }) }
  }

  const results = []
  for (const item of res?.Items ?? []) {
    const decoding = decode(unmarshall(item))
    if (decoding.error) return decoding
    results.push(decoding.ok)
  }

  return { ok: results }
}

process.on('SIGINT', () => {
  console.error('\nReceived SIGINT, flushing partial state...')
  console.log('cursor:', cursor)
  writeManualAttentionCsv(manualAttention)
  throw new Error('Process interrupted by SIGINT')
})

process.on('SIGTERM', () => {
  console.error('\nReceived SIGTERM, flushing partial state...')
  console.log('cursor:', cursor)
  writeManualAttentionCsv(manualAttention)
  throw new Error('Process interrupted by SIGTERM')
})

try {
  await main()
} catch (err) {
  console.log('cursor:', cursor)
  console.error('Error while listing batches:', err)
  writeManualAttentionCsv(manualAttention)
}

/**
 * Helper functions
 */


/**
 *
 * @param {string} planName
 * @param {number} byteQuantity
 */
function getOveragesValue(planName, byteQuantity) {
  const planPrices = productOveragesPrices[/** @type {keyof typeof productOveragesPrices} */ (planName)]
  if (byteQuantity <= planPrices.maxBytes) return 0
  const overageBytes = byteQuantity - planPrices.maxBytes
  return overageBytes * planPrices.costPerByte
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
 * Write manual attention records to CSV file
 * 
 * @param {ManualAttentionRecord[]} rows
 */
function writeManualAttentionCsv(rows) {
  if(rows.length === 0) return
  const header = [
    'customer_email',
    'plan',
    'stripe_customer_id',
    'subscription_status',
    'total_usage',
    'byte_quantity',
    'overage_charge',
    'invoice_id',
    'customer_did',
    'reason'
  ]
  const lines = [header.join(',')]
  for (const r of rows) {
    lines.push([
      r.customerEmail || '',
      r.plan,
      r.stripeCustomerId,
      r.subscriptionStatus || '',
      r.totalUsage || '',
      r.byteQuantity || '',
      r.overageCharge || '',
      r.invoiceId || '',
      r.customerDid,
      r.reason
    ].join(','))
  }
  const outPath = path.resolve(process.cwd(), 'manual-attention.csv')
  fs.writeFileSync(outPath, lines.join('\n'))
  console.log(`\nManual attention CSV written: ${outPath} (${rows.length} rows)`)
}