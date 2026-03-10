#!/usr/bin/env node

/**
 * Get all spaces egress for a customer in a month from the egress-traffic-monthly table
 * and compare with the egress value on Stripe
 */

import dotenv from 'dotenv'
import Stripe from 'stripe'
import { mustGetEnv } from '../../../lib/env.js'
import { createEgressTrafficMonthlyStore } from '../../tables/egress-traffic-monthly.js'
import { createCustomerStore } from '../../tables/customer.js'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'

dotenv.config({ path: '.env.local' })

const STORACHA_ENV = mustGetEnv('STORACHA_ENV')
const STRIPE_API_KEY = mustGetEnv('STRIPE_API_KEY')

const CUSTOMER_TABLE_NAME=`${STORACHA_ENV}-w3infra-customer`
const EGRESS_MONTHLY_TABLE_NAME = `${STORACHA_ENV}-w3infra-egress-traffic-monthly`

const STRIPE_BILLING_EVENT = {
  name: 'gateway-egress-traffic',
  id: 'mtr_61RVvCPLAzHVlA84841F6A5ufQX5v4am'
}

const stripe = new Stripe(STRIPE_API_KEY)

const dynamo = new DynamoDBClient()

const customerStore = createCustomerStore(dynamo, { tableName: CUSTOMER_TABLE_NAME })
const monthlyStore = createEgressTrafficMonthlyStore(dynamo, { tableName: EGRESS_MONTHLY_TABLE_NAME })


/**
 * @param {object} params
 * @param {string} params.customer
 * @param {string} params.month
 */
async function getCustomerEgressInfo({customer, month}) {
    console.log(`Reading egress events for ${customer} from ${month}`)
    console.log(`Environment: ${STORACHA_ENV}\n`)

    const info = await monthlyStore.listByCustomer(customer, month)
    if(info.error) throw info.error
    console.log(info.ok)

    const { ok: record, error } = await customerStore.get({ 
        customer: /** @type {`did:mailto:${string}`} */ (customer) 
    })
    if (error) throw error
    if (!record.account) {
        console.error('Customer does not have associated stripe account')
        return
    }

    const stripeCustomerId = record.account.replace('stripe:', '')

    const from = new Date(`${month}-01`)
    const to = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 0, 23, 59, 59, 999)) // uses day 0 of the next month, which resolves to the last day of the current month.

    const totalAggregatedEvents = await stripe.billing.meters.listEventSummaries(STRIPE_BILLING_EVENT.id, {
        customer: stripeCustomerId,
        start_time: Math.floor(from.getTime() / 1000),
        end_time: Math.floor(to.getTime() / 1000),
    });

    const totalAggregatedValue = totalAggregatedEvents.data.reduce((sum, event) => sum + event.aggregated_value, 0)
   
    console.log(`Stripe total aggregated usage for ${month}:`,totalAggregatedValue)

    console.log('-'.repeat(55))
    if (totalAggregatedValue !== info.ok?.total) {
        console.log(
            "⚠️  Aggregated egress does not match Stripe.\n" +
            "To investigate, run '1-read-events-and-aggregate.js' to compute the correct value from the raw events."
        )
    } else {
        console.log(`✅ Egress aggregate verified. Values match (${totalAggregatedValue}).`)
    }
    console.log('-'.repeat(55))

}


// CLI parsing
const args = process.argv.slice(2)
const customer = args.find((e) => e.startsWith('customer='))?.split('customer=')[1]
const month = args.find((e) => e.startsWith('month='))?.split('month=')[1]

if (!customer || !month) {
  console.error('Usage: node 3-get-customer-egress-from-monthly-table.js customer=did:mailto:example.com:alice month=yyyy-mm')
  process.exit(1)
}

try {
  await getCustomerEgressInfo({ customer, month })
} catch (/** @type {any} */ err) {
  console.error('Fatal error:', err)
  process.exit(1)
}
