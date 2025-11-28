import pMap from 'p-map'
import fs from 'node:fs'
import path from 'node:path'
import dotenv from 'dotenv'
import Stripe from 'stripe'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import * as DidMailto from '@storacha/did-mailto'
import { startOfMonth } from '../../lib/util.js'
import { mustGetEnv } from '../../../lib/env.js'
import { createCustomerStore } from '../../tables/customer.js'
import { oldPriceIds, oldPricesNames, oldPricesValue, oldToNewPrices } from './prices-config.js'
import { PRICES_TO_PLANS_MAPPING } from '../../../upload-api/constants.js'

dotenv.config({ path: '.env.local' })

// Required env vars
const STRIPE_API_KEY = mustGetEnv('STRIPE_API_KEY')
const STORACHA_ENV = /** @type {'prod' | 'staging'} */ (mustGetEnv('STORACHA_ENV'))
const CUSTOMER_TABLE_NAME = `${STORACHA_ENV}-w3infra-customer`

const MAX_PARALLEL = Number(process.env.DUPE_MAX_PARALLEL || 5)

const stripe = new Stripe(STRIPE_API_KEY)
const dynamo = new DynamoDBClient()
const customerStore = createCustomerStore(dynamo, { tableName: CUSTOMER_TABLE_NAME })

/**
 * Manual Attention Record
 *
 * @typedef {object} ManualAttentionRecord
 * @property {string|null} customerEmail
 * @property {string} plan
 * @property {string} subscriptionId
 * @property {string} subscriptionStatus
 * @property {string|null} customerStripeUrl
 * @property {string|null} customerDid
 * @property {string} reason
 */
/** @type {ManualAttentionRecord[]} */
const manualAttention = []

// Get the current date and calculate the next first of the month
const nextMonth = startOfMonth(new Date())
nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1) // 1st at 00:00:00 UTC

// Convert to Unix timestamp in seconds (used to align next phase start)
const nextMonthTimestamp = Math.floor(nextMonth.getTime() / 1000)

console.log(
  `\nPlanning to migrate all subscriptions to bill on the 1st of each month starting on ${nextMonth.toISOString()}\n`
)

const startMs = Date.now()

// --- Batch Processing, Progress Reporting, Configurable Start Point ---
const LAST_ID_ARG = process.argv.find(a => a.startsWith('--lastId='))
const lastId = LAST_ID_ARG ? LAST_ID_ARG.split('=')[1] : null

const PRICE_ID_ARG = process.argv.find(a => a.startsWith('--priceId='))
const singlePriceId = PRICE_ID_ARG ? PRICE_ID_ARG.split('=')[1] : null

let lastProcessedId = lastId || null
const priceIdsToProcess = singlePriceId ? [singlePriceId] : oldPriceIds[STORACHA_ENV];

async function main() {
  for (const oldPriceId of priceIdsToProcess) {
    console.log(
      `----------------------------------------------------------------------------------------------------`
    )
    console.log(
      `Processing subscriptions with price: ${oldPricesNames[oldPriceId]} (${oldPriceId})`
    )

    let processedCount = 0
    const filters = {
      price: oldPriceId,
      expand: ['data.schedule', 'data.items'],
    }

    let batchNum = 0
    let more = true
    while (more) {
      batchNum++
      const paginationParams = lastProcessedId ? { starting_after: lastProcessedId } : {}

      const subscriptionBatch = await stripe.subscriptions.list({
        ...filters,
        ...paginationParams,
        limit: 100,
      })
      const batch = subscriptionBatch.data

      if (!batch.length || batch.length < 1) break

      console.log(`\nProcessing batch ${batchNum} (${batch[0]?.id} - ${batch[batch.length-1]?.id})`)

      await pMap(batch, async (subscription) => {
        try {
          const customerId = /** @type {string} */ (subscription.customer)
          const customer = await stripe.customers.retrieve(customerId)

          if(!customer || customer.deleted || !customer.email) {
            console.log(`\t!!! Customer ${customerId} not found or deleted, skipping subscription ${subscription.id}\n`)
            manualAttention.push({
              customerEmail: '',
              plan: oldPricesNames[oldPriceId],
              subscriptionId: subscription.id,
              subscriptionStatus: subscription.status,
              customerStripeUrl: stripeCustomerUrl(customerId),
              customerDid: '',
              reason: 'Customer not found or deleted'
            })
            return
          }

          const customerEmail = customer.email
          const customerDid = DidMailto.fromEmail(/** @type {`${string}@${string}`} */ (customerEmail))

          if(subscription.status === 'canceled') {
            console.log(`\t!!! Subscription ${subscription.id} is not active, skipping...`)
            manualAttention.push({
              customerEmail,
              plan: oldPricesNames[oldPriceId],
              subscriptionId: subscription.id,
              subscriptionStatus: subscription.status,
              customerStripeUrl: stripeCustomerUrl(customerId),
              customerDid,
              reason: 'Subscription is not active'
            })
            return
          }

          // skip if schedule is already set up
          if (subscription.schedule && typeof subscription.schedule !== 'string') {
            console.log(`\tSubscription already has a schedule ${subscription.schedule.id}, skipping...`)
            manualAttention.push({
              customerEmail,
              plan: oldPricesNames[oldPriceId],
              subscriptionId: subscription.id,
              subscriptionStatus: subscription.status,
              customerStripeUrl: stripeCustomerUrl(customerId),
              customerDid,
              reason: 'Subscription already has a schedule'
            })
            return
          }

          console.log(`\n------> Processing subscription: ${subscription.id}`)

          const schedule = await stripe.subscriptionSchedules.create({ from_subscription: subscription.id })

          console.log(`\t[${subscription.id}] Created new schedule: ${schedule.id}`)
          console.log(`\t[${subscription.id}] Updating subscription schedule...`)

          // Determine proration info
          const proration = computeProration(subscription)

          console.log(`\t[${subscription.id}] Subscription ends ${proration.endsBefore ? 'before' : 'after'} the 1st of next month.`)
          console.log(`\t[${subscription.id}] Period total days: ${proration.totalDays.toFixed(0)}`)

          // Use flat fee from mapping (usage-based unit_amount may be null)
          const regularAmount = oldPricesValue[oldPriceId]

          if (proration.deltaDays > 0) {
            console.log(`\t[${subscription.id}] User should pay for additional days: ${proration.deltaDays.toFixed(0)}`)
            console.log(`\t[${subscription.id}] Extension ratio per day: ${proration.ratio.toFixed(4)}`)
          } else if (proration.deltaDays < 0) {
            console.log(`\t[${subscription.id}] User should receive credits for unused days: ${Math.abs(proration.deltaDays).toFixed(0)}`)
            console.log(`\t[${subscription.id}] Unused ratio per day: ${proration.ratio.toFixed(4)}`)
          }

          // Apply adjustments (credits or charges)
          await applyProrationAdjustments(subscription, regularAmount, proration)

          // Build new phase items from mapping
          const newPhaseItems = [
            { price: oldToNewPrices[STORACHA_ENV][oldPriceId].flatFee },
            { price: oldToNewPrices[STORACHA_ENV][oldPriceId].overageFee },
            { price: oldToNewPrices[STORACHA_ENV][oldPriceId].egressFee }, 
          ]

          // Update the subscription schedule with consolidated phases
          const updatedSchedule = await stripe.subscriptionSchedules.update(
            schedule.id,
            {
              phases: buildPhases(subscription, proration, newPhaseItems),
            }
          )

          console.log(`\t[${subscription.id}] Successfully updated schedule ${updatedSchedule.id}`)

          const priceId = oldToNewPrices[STORACHA_ENV][oldPriceId].flatFee
          const productName = PRICES_TO_PLANS_MAPPING[STORACHA_ENV][priceId]
          await updateDynamoCustomerProduct(customerDid, customerId, productName)
        
          console.log(`\t[${subscription.id}] Successfully updated customer ${customerDid} to product: ${productName}\n`)

          processedCount++
          console.log(`\n[${oldPricesNames[oldPriceId]}] batch ${batchNum}: processed=${processedCount} / total=${batch.length}\n`)
          lastProcessedId = subscription.id
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          console.error(`\t!!! Error processing subscription ${subscription.id}: ${message}\n`)
          manualAttention.push({
            customerEmail:'',
            plan: oldPricesNames[oldPriceId],
            subscriptionId: subscription.id,
            subscriptionStatus: subscription.status,
            customerStripeUrl: stripeCustomerUrl(/** @type {string} */ (subscription.customer)),
            customerDid: '',
            reason: `Error: ${message}`
          })
        }
      }, { concurrency: MAX_PARALLEL })

      logDuration('Batch duration')
      writeManualAttentionCsv(manualAttention)
      console.log(`Batch ${batchNum} complete.`)
      more = subscriptionBatch.has_more
    }

    console.log('All subscriptions processed for price:', oldPricesNames[oldPriceId])
    console.log('lastProcessedId:', lastProcessedId)
    logDuration('Total duration')
    writeManualAttentionCsv(manualAttention)
  }
} 

process.on('SIGINT', () => {
  console.error('\nReceived SIGINT, flushing partial state...')
  console.log('lastProcessedId:', lastProcessedId)
  writeManualAttentionCsv(manualAttention)
  throw new Error('Process interrupted by SIGINT')
})

process.on('SIGTERM', () => {
  console.error('\nReceived SIGTERM, flushing partial state...')
  console.log('lastProcessedId:', lastProcessedId)
  writeManualAttentionCsv(manualAttention)
  throw new Error('Process interrupted by SIGTERM')
})

try {
  await main()
} catch(err) {
  console.log('lastProcessedId:', lastProcessedId)
  console.error('Error while listing batches:',err)
  writeManualAttentionCsv(manualAttention)
}


/**
 * Typedefs for JSDoc-typed helper functions
 */

/**
 * @typedef {import('stripe').Stripe.Subscription} StripeSubscription
 * @typedef {import('stripe').Stripe.SubscriptionSchedule} StripeSchedule
 * @typedef {import('stripe').Stripe.SubscriptionSchedule.Phase} StripePhase
 * @typedef {{ price: string, quantity?: number } | { 
 *    price_data: { 
 *      currency: string, 
 *      product: string, 
 *      recurring: { interval: string }, 
 *      unit_amount: number 
 *    }, 
 *      quantity?: number 
 * }} SchedulePhaseItemInput
 * @typedef {{ start: number, end: number }} InvoiceItemPeriod
 * @typedef {import('stripe').Stripe.Customer | import('stripe').Stripe.DeletedCustomer | string} ExpandableCustomer
 * @typedef {{
 *   customer: ExpandableCustomer,
 *   amount: number,
 *   currency: string,
 *   description: string,
 *   period?: InvoiceItemPeriod
 * }} InvoiceItemParams
 * @typedef {{ endsBefore: boolean, totalDays: number, deltaDays: number, ratio: number }} ProrationInfo
 * @typedef {{
 *   start_date: number,
 *   end_date?: number,
 *   items: Array<SchedulePhaseItemInput>,
 *   proration_behavior?: 'none' | 'always_invoice' | 'create_prorations',
 *   trial?: boolean,
 *   billing_cycle_anchor?: 'phase_start'
 * }} StripeSchedulePhaseInput
 */

/** Build Stripe dashboard URL for a customer id.
 *
 * @param {string} id
 * @returns {string}
 */
function stripeCustomerUrl(id) {
  return `https://dashboard.stripe.com/acct_1LO87hF6A5ufQX5v/customers/${id}`
}

function logDuration(label = 'Duration') {
  const elapsedMs = Date.now() - startMs
  const hours = Math.floor(elapsedMs / 3600000)
  const minutes = Math.floor((elapsedMs % 3600000) / 60000)
  const seconds = Math.floor((elapsedMs % 60000) / 1000)
  const formatted = `${String(hours).padStart(2,'0')}:${String(minutes).padStart(2,'0')}:${String(seconds).padStart(2,'0')}`
  console.log(`${label}: ${formatted}`)
}

/** Update dynamo customer table with the new product name
 *
 * @param {`did:mailto:${string}`} emailDid
 * @param {string} customerId
 * @param {string} product
 * @returns {Promise<void>}
 */
async function updateDynamoCustomerProduct(emailDid, customerId, product) {
  try {
    const customerResponse = await customerStore.get({customer: emailDid})
    if (customerResponse.error) throw customerResponse.error

    const stripeAccount = customerResponse.ok.account?.replace('stripe:', '')
    if (stripeAccount !== customerId) {
      throw new Error(`Customer ID mismatch for ${emailDid}: expected ${customerId}, found ${stripeAccount}`)
    }

    const res = await customerStore.updateProduct(emailDid, product)
    if (res.error) throw res.error
  } catch (err) {
    console.error(`\t!!! Error updating customer product ${product} for ${emailDid}:`,err)
    throw new Error(`Error updating customer product ${product} for ${emailDid}`, {cause: err})
  }
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
    'subscription_id',
    'subscription_status',
    'customer_stripe_url',
    'customer_did',
    'reason'
  ]
  const lines = [header.join(',')]
  for (const r of rows) {
    lines.push([
      r.customerEmail || '',
      r.plan,
      r.subscriptionId,
      r.subscriptionStatus,
      r.customerStripeUrl || '',
      r.customerDid || '',
      r.reason
    ].join(','))
  }
  const outPath = path.resolve(process.cwd(), 'manual-attention.csv')
  fs.writeFileSync(outPath, lines.join('\n'))
  console.log(`\nManual attention CSV written: ${outPath} (${rows.length} rows)`)
}

/**
 * Create an invoice item if amount !== 0
 *
 * @param {InvoiceItemParams} params
 * @returns {Promise<import('stripe').Stripe.InvoiceItem | null>}
 */
async function safeCreateInvoiceItem(params) {
  const { customer, amount, currency, description, period } = params
  if (!amount || amount === 0) return null
  const customerId = typeof customer === 'string' ? customer : customer.id
  return stripe.invoiceItems.create({
    customer: customerId,
    amount,
    currency,
    description,
    ...(period ? { period } : {})
  })
}

/**
 * Compute proration info for the transition.
 * Returns { endsBefore: boolean, totalDays: number, deltaDays: number, ratio: number }
 * - deltaDays > 0 means we need to extend the subscription until the 1st (charge)
 * - deltaDays < 0 means there are unused days after the 1st (credit)
 *
 * @param {StripeSubscription} subscription
 * @returns {ProrationInfo}
 */
function computeProration(subscription) {
  const secondsInDay = 60 * 60 * 24
  const currentPeriodStart = subscription.current_period_start
  const currentPeriodEnd = subscription.current_period_end
  const totalDays = (currentPeriodEnd - currentPeriodStart) / secondsInDay
  const deltaSeconds = nextMonthTimestamp - currentPeriodEnd
  const deltaDays = deltaSeconds / secondsInDay
  const ratio = totalDays > 0 ? Math.abs(deltaDays) / totalDays : 0
  const endsBefore = currentPeriodEnd < nextMonthTimestamp

  return { endsBefore, totalDays, deltaDays, ratio }
}

/**
 * Create credits or extension charges for a subscription based on proration.
 * regularAmount is the flat fee for the old price plan (in cents).
 *
 * @param {StripeSubscription} subscription
 * @param {number} regularAmount
 * @param {ProrationInfo} proration
 * @returns {Promise<void>}
 */
async function applyProrationAdjustments(subscription, regularAmount, proration) {
  const { endsBefore, deltaDays, totalDays } = proration
  if (totalDays <= 0 || regularAmount === 0) {
    // nothing to do (invalid period or free plan)
    return
  }

  // daily rate in cents (may be fractional)
  const dailyRate = regularAmount / totalDays;

  if (endsBefore) {
    // Extension: any partial day -> bill as a full day
    const daysToBill = Math.ceil(deltaDays);
    const adjustmentAmount = Math.round(dailyRate * daysToBill);
    if (adjustmentAmount <= 0) return;

    const desc = `Prorated extension charge for ${daysToBill} day${daysToBill === 1 ? '' : 's'} of service.`
    await safeCreateInvoiceItem({
      customer: subscription.customer,
      amount: adjustmentAmount,
      currency: subscription.currency,
      description: desc,
      period: {
        start: subscription.current_period_end,
        end: nextMonthTimestamp
      }
    })
    console.log(`\t[${subscription.id}] Created extension invoice item: ${adjustmentAmount} (${desc})`)
  } else {
    // Credit: only full unused days are credited
    const daysToCredit = Math.floor(Math.abs(deltaDays));
    const adjustmentAmount = Math.round(dailyRate * daysToCredit);
    if (adjustmentAmount <= 0) return;

    const desc = `Credit for ${daysToCredit} unused day${daysToCredit === 1 ? '' : 's'} of subscription.`
    await safeCreateInvoiceItem({
      customer: subscription.customer,
      amount: -adjustmentAmount,
      currency: subscription.currency,
      description: desc,
    })
    console.log(`\t[${subscription.id}] Created credit invoice item: -${adjustmentAmount} (${desc})`)
  }
}

/**
 * Build the phases array to send to stripe.subscriptionSchedules.update/create
 *
 * @param {StripeSubscription} subscription
 * @param {ProrationInfo} proration
 * @param {Array<SchedulePhaseItemInput>} newPhaseItems
 * @returns {Array<Stripe.SubscriptionScheduleCreateParams.Phase>}
 */
function buildPhases(subscription, proration, newPhaseItems) {
  const { endsBefore } = proration

  const mapCurrentItems = subscription.items.data.map(item => ({
    price: item.price.id,
    quantity: item.quantity
  }))

  const bridgeItems = subscription.items.data.map(item => ({
    price_data: {
      currency: item.price.currency,
      product: item.price.product,
      recurring: { interval: 'day' },
      unit_amount: 0
    },
    quantity: item.quantity
  }))


  const phases = [
    {
      start_date: subscription.current_period_start,
      end_date: endsBefore ? subscription.current_period_end : nextMonthTimestamp,
      items: mapCurrentItems,
      proration_behavior: 'none'
    },
    ...(endsBefore ? [{
      start_date: subscription.current_period_end,
      end_date: nextMonthTimestamp,
      items: bridgeItems,
      proration_behavior: 'none',
      trial: true
    }] : []),
    {
      start_date: nextMonthTimestamp,
      items: newPhaseItems,
      billing_cycle_anchor: 'phase_start',
      proration_behavior: 'none'
    }
  ]
  return /** @type {Array<Stripe.SubscriptionScheduleCreateParams.Phase>} */ (phases)
}
