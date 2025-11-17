import dotenv from 'dotenv'
import Stripe from 'stripe'
import { startOfMonth } from '../../lib/util.js'

import { mustGetEnv } from '../../../lib/env.js'
dotenv.config({ path: '.env.local' })

const STRIPE_API_KEY = mustGetEnv('STRIPE_API_KEY')

const stripe = new Stripe(STRIPE_API_KEY)

const STARTER_PRICE_ID = 'price_1QPQUzFLBc8xGwvUcZnO7sxY' // $0 + $0.15 per GB
const LITE_PRICE_ID = 'price_1QPRLcFLBc8xGwvUQEGdzJF0' // $10 + $0.05 per GB
const BUSINESS_PRICE_ID = 'price_1QPRO4FLBc8xGwvUcnEdzOnY' // $100 + $0.03 per GB

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
 * @typedef {'price_1QPQUzFLBc8xGwvUcZnO7sxY' | 'price_1QPRLcFLBc8xGwvUQEGdzJF0' | 'price_1QPRO4FLBc8xGwvUcnEdzOnY'} OldPriceId
 * @typedef {{ flatFee: string, overageFee: string, egressFee: string }} PriceCombo
 */

// Mapping of old prices to new price combinations
/** @type {Record<OldPriceId, PriceCombo>} */
const oldToNewPrices = {
  [STARTER_PRICE_ID]: {
    flatFee: 'price_1SDXxgFLBc8xGwvUH3YfRMwM',
    overageFee: 'price_1SDY0iFLBc8xGwvUrlV18Heb',
    egressFee: 'price_1SIa2lFLBc8xGwvUE7Qas74l'
  },
  [LITE_PRICE_ID]: {
    flatFee: 'price_1SDY3fFLBc8xGwvUkghmC77u',
    overageFee: 'price_1SDY5BFLBc8xGwvUWysDI2NO',
    egressFee: 'price_1SIa5TFLBc8xGwvUXTzVF6n9',
  },
  [BUSINESS_PRICE_ID]: {
    flatFee: 'price_1SDY5yFLBc8xGwvUTGQJ548z',
    overageFee: 'price_1SKjiEFLBc8xGwvUCKbHlreL',
    egressFee: 'price_1SKjeCFLBc8xGwvUvHUqEEmd'
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
 * @typedef {{ customer: string, amount: number, currency: string, description: string }} InvoiceItemParams
 * @typedef {{ endsBefore: boolean, totalDays: number, deltaDays: number, ratio: number }} ProrationInfo
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
  const { customer, amount, currency, description } = params
  if (!amount || amount === 0) return null
  return stripe.invoiceItems.create({
    customer,
    amount,
    currency,
    description,
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

  for (const item of subscription.items.data) {
    if (endsBefore) {
      // Extension: any partial day -> bill as a full day
      const daysToBill = Math.ceil(deltaDays);
      const adjustmentAmount = Math.round(dailyRate * daysToBill);
      if (adjustmentAmount <= 0) continue;

      const startReadable = formatShortMonthDay(subscription.current_period_end);
      const endReadable = formatShortMonthDay(nextMonthTimestamp);
      const desc = `Prorated extension charge for ${daysToBill} day${daysToBill === 1 ? '' : 's'} of service, from ${startReadable} to ${endReadable}.`
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
      if (adjustmentAmount <= 0) continue;

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
}

/**
 * Build the phases array to send to stripe.subscriptionSchedules.update/create
 *
 * @param {StripeSubscription} subscription
 * @param {ProrationInfo} proration
 * @param {Array<Object>} newPhaseItems
 * @returns {Array<Object>}
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

  return phases
}

/**
 * Format a date string from epoch seconds to a short month/day format.
 *
 * @param {number} epochSeconds
 * @returns {string}
 */
function formatShortMonthDay(epochSeconds) {
  return new Date(epochSeconds * 1000)
    .toLocaleString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}