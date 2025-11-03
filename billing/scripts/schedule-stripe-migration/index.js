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
    egressFee: 'price_1SIa5TFLBc8xGwvUXTzVF6n9'
  },
  [BUSINESS_PRICE_ID]: {
    flatFee: 'price_1SDY5yFLBc8xGwvUTGQJ548z',
    overageFee: 'price_1SDY7iFLBc8xGwvUNTlL50aK',
    egressFee: 'price_1SIa7JFLBc8xGwvU0il2JRSE'
  },
}

const oldPriceIds = /** @type {OldPriceId[]} */ (Object.keys(oldToNewPrices))

// Get the current date and calculate the next first of the month
const nextMonth = startOfMonth(new Date())
nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1)

// Convert to Unix timestamp in seconds (used to align next phase start)
const nextMonthTimestamp = Math.floor(nextMonth.getTime() / 1000)

console.log(
  `\nPlanning to migrate all subscriptions to bill on the 1st of each month starting on ${nextMonth.toISOString()}\n`
)

// Process each old price
for (const oldPriceId of oldPriceIds) {
  console.log(`----------------------------------------------------------------------------------------------------`)
  console.log(`Processing subscriptions with price: ${oldPricesNames[oldPriceId]} (${oldPriceId})`)

  // Fetch all subscriptions with this price
  const subscriptions = await stripe.subscriptions.list({
    price: oldPriceId,
    expand: ['data.schedule'],
  })

  console.log(
    `\nFound ${subscriptions.data.length} subscriptions`
  )

  // Process each subscription
  for (const subscription of subscriptions.data) {
    try {
      console.log(`\n------> Processing subscription: ${subscription.id}`)

      // Create or retrieve subscription schedule
      let schedule
      if (subscription.schedule && typeof subscription.schedule !== 'string') {
        schedule = subscription.schedule
        console.log(`\tSubscription already has a schedule ${schedule.id}. Releasing it first...`)
        const releasedSchedule = await stripe.subscriptionSchedules.release(schedule.id)

        schedule = await stripe.subscriptionSchedules.create({
          from_subscription: subscription.id,
        })
        console.log(`\tReleased old schedule: ${releasedSchedule.id} and created new schedule: ${schedule.id}`)
      } else {
        schedule = await stripe.subscriptionSchedules.create({
          from_subscription: subscription.id,
        })
        console.log(`\tCreated new schedule: ${schedule.id}`)
      }

      console.log(`\tUpdating subscription schedule...`)
      const startDate = schedule.phases[0].start_date

      // Update the subscription schedule
      const updatedSchedule = await stripe.subscriptionSchedules.update(
        schedule.id,
        {
          phases: [
            // Current phase - keep the existing price until the current period ends
            {
              start_date: startDate,
              end_date: nextMonthTimestamp, // End exactly when the next phase starts,
              items: subscription.items.data.map((item) => ({
                price: item.price.id,
              })),
              proration_behavior: 'create_prorations', // Create prorations for the extended period. This means the customer will be charged for the extra days until the end of the current month.
            },
            // New phase - switch to new price combination on the first of the next month
            {
              start_date: nextMonthTimestamp,
              items: [
                {
                  price: oldToNewPrices[oldPriceId].flatFee,
                },
                {
                  price: oldToNewPrices[oldPriceId].overageFee,
                },
                {
                  price: oldToNewPrices[oldPriceId].egressFee,
                },
              ],
              billing_cycle_anchor: 'phase_start', // Reset billing anchor to the 1st
              proration_behavior: 'none'
            },
          ],
        },
      )

      console.log(
        `\tSuccessfully updated schedule ${updatedSchedule.id} for subscription: ${subscription.id}\n`,
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error(
        `\t!!! Error processing subscription ${subscription.id}: ${message}\n`
      )
    }
  }
}
