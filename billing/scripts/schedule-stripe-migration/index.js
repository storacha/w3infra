import dotenv from 'dotenv'
import Stripe from 'stripe'
import { startOfMonth } from '../../lib/util.js'

import { mustGetEnv } from '../../../lib/env.js'
dotenv.config({ path: '.env.local' })

const STRIPE_API_KEY = mustGetEnv('STRIPE_API_KEY')

const stripe = new Stripe(STRIPE_API_KEY)

const STARTER_PRICE_ID = 'price_1OCGzeF6A5ufQX5v1EDCK765' // $0 + $0.15 per GB
const LITE_PRICE_ID = 'price_1OCH4DF6A5ufQX5vQYB8fyDh' // $10 + $0.05 per GB
const BUSINESS_PRICE_ID = 'price_1OCHHeF6A5ufQX5veYO8Q4xQ' // $100 + $0.03 per GB

const oldPricesNames = {
  [STARTER_PRICE_ID]: 'STARTER',
  [LITE_PRICE_ID]: 'LITE',
  [BUSINESS_PRICE_ID]: 'BUSINESS',
}

const oldPricesValue = {
  [STARTER_PRICE_ID]: 0,
  [LITE_PRICE_ID]: 10 * 100,
  [BUSINESS_PRICE_ID]: 100 * 100,
}

/**
 * @typedef {'price_1OCGzeF6A5ufQX5v1EDCK765' | 'price_1OCH4DF6A5ufQX5vQYB8fyDh' | 'price_1OCHHeF6A5ufQX5veYO8Q4xQ'} OldPriceId
 * @typedef {{ flatFee: string, overageFee: string, egressFee: string }} PriceCombo
 */

// Mapping of old prices to new price combinations
/** @type {Record<OldPriceId, PriceCombo>} */
const oldToNewPrices = {
  [STARTER_PRICE_ID]: {
    flatFee: 'price_1SUtuZF6A5ufQX5vLdJgK8gW',
    overageFee: 'price_1SUtv3F6A5ufQX5vTZHG0J7s',
    egressFee: 'price_1SUtv6F6A5ufQX5v4w4JmhoU'
  },
  [LITE_PRICE_ID]: {
    flatFee: 'price_1SUtvAF6A5ufQX5vM1Dc3Kpl',
    overageFee: 'price_1SUtvEF6A5ufQX5vI9ReH4wb',
    egressFee: 'price_1SUtvIF6A5ufQX5v2AKQcSKf',
  },
  [BUSINESS_PRICE_ID]: {
    flatFee: 'price_1SUtvLF6A5ufQX5vjHMdUcHh',
    overageFee: 'price_1SUtvOF6A5ufQX5vO9WL1jF7',
    egressFee: 'price_1SUtvSF6A5ufQX5vaTkB55xm'
  },
}

const oldPriceIds = /** @type {OldPriceId[]} */ (Object.keys(oldToNewPrices))

// Get the current date and calculate the next first of the month
const nextMonth = startOfMonth(new Date())
nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1) // 1st at 00:00:00 UTC

// Convert to Unix timestamp in seconds (used to align next phase start)
const nextMonthTimestamp = Math.floor(nextMonth.getTime() / 1000)

console.log(
  `\nPlanning to migrate all subscriptions to bill on the 1st of each month starting on ${nextMonth.toISOString()}\n`
)

// Process each old price
for (const oldPriceId of oldPriceIds) {
  console.log(
    `----------------------------------------------------------------------------------------------------`
  )
  console.log(
    `Processing subscriptions with price: ${oldPricesNames[oldPriceId]} (${oldPriceId})`
  )

  // Fetch all subscriptions with this price
  const subscriptions = await stripe.subscriptions.list({
    price: oldPriceId,
    expand: ['data.schedule', 'data.items'],
  })

  console.log(`\nFound ${subscriptions.data.length} subscriptions`)

  // Process each subscription
  for (const subscription of subscriptions.data) {
    try {
      console.log(`\n------> Processing subscription: ${subscription.id}`)

      // Create or retrieve a fresh schedule
      const schedule = await createFreshScheduleFromSubscription(subscription)

      console.log(`\tUpdating subscription schedule...`)

      // Determine proration info
      const proration = computeProration(subscription)
      console.log(
        `\tSubscription ends ${
          proration.endsBefore ? 'before' : 'after'
        } the 1st of next month.`
      )
      console.log(`\tPeriod total days: ${proration.totalDays.toFixed(1)}`)

      // Use flat fee from mapping (usage-based unit_amount may be null, so we keep the explicit flat fee)
      const regularAmount = oldPricesValue[oldPriceId]

      if (proration.deltaDays > 0) {
        console.log(
          `\tUser should pay for additional days: ${proration.deltaDays.toFixed(
            1
          )}`
        )
        console.log(`\tExtension ratio per day: ${proration.ratio.toFixed(4)}`)
      } else if (proration.deltaDays < 0) {
        console.log(
          `\tUser should receive credits for unused days: ${Math.abs(
            proration.deltaDays
          ).toFixed(1)}`
        )
        console.log(`\tUnused ratio per day: ${proration.ratio.toFixed(4)}`)
      }

      // Apply adjustments (credits or charges)
      await applyProrationAdjustments(subscription, regularAmount, proration)

      // Build new phase items from mapping
      const newPhaseItems = [
        { price: oldToNewPrices[oldPriceId].flatFee },
        { price: oldToNewPrices[oldPriceId].overageFee },
        { price: oldToNewPrices[oldPriceId].egressFee }, 
      ]

      // Update the subscription schedule with consolidated phases
      const updatedSchedule = await stripe.subscriptionSchedules.update(
        schedule.id,
        {
          phases: buildPhases(subscription, proration, newPhaseItems),
        }
      )

      console.log(
        `\tSuccessfully updated schedule ${updatedSchedule.id} for subscription: ${subscription.id}\n`
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error(
        `\t!!! Error processing subscription ${subscription.id}: ${message}\n`
      )
    }
  }
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

/**
 * Create or recreate a schedule from a subscription.
 * If the subscription has an object schedule, release it and create a new one.
 * Returns the newly created schedule object.
 *
 * @param {StripeSubscription} subscription
 * @returns {Promise<StripeSchedule>}
 */
async function createFreshScheduleFromSubscription(subscription) {
  if (subscription.schedule && typeof subscription.schedule !== 'string') {
    const existing = subscription.schedule
    console.log(`\tSubscription already has a schedule ${existing.id}. Releasing it first...`)
    const released = await stripe.subscriptionSchedules.release(existing.id)
    const created = await stripe.subscriptionSchedules.create({ from_subscription: subscription.id })
    console.log(`\tReleased old schedule: ${released.id} and created new schedule: ${created.id}`)
    return created
  } else {
    const created = await stripe.subscriptionSchedules.create({ from_subscription: subscription.id })
    console.log(`\tCreated new schedule: ${created.id}`)
    return created
  }
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
    console.log(`\tCreated extension invoice item: ${adjustmentAmount} (${desc})`)
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
    console.log(`\tCreated credit invoice item: -${adjustmentAmount} (${desc})`)
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
