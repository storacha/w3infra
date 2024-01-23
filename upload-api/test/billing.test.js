import { createStripeBillingProvider } from '../billing.js'
import { test } from './helpers/context.js'
import { toEmail } from '@web3-storage/did-mailto'
import dotenv from 'dotenv'

import Stripe from 'stripe'
import { fileURLToPath } from 'node:url'

dotenv.config({ path: fileURLToPath(new URL('../../.env', import.meta.url)) })

/**
 * 
 * @param {Stripe} stripe 
 * @param {string} email 
 * @returns {Promise<string | null | undefined>}
 */
async function getCustomerPlanByEmail(stripe, email) {
  const customers = await stripe.customers.list({ email, expand: ['data.subscriptions'] })
  if (customers.data.length > 1) throw new Error(`found more than one customer with email ${email}`)
  const customer = customers.data[0]
  if (customer) {
    return customer.subscriptions?.data[0].items.data[0].price.lookup_key
  }
}

/**
 * 
 * @param {Stripe} stripe 
 * @param {string} email 
 * @returns {Promise<Stripe.Customer>}
 */
async function setupCustomer(stripe, email) {
  const customer = await stripe.customers.create({ email })

  // set up a payment method - otherwise we won't be able to update the plan later
  let setupIntent = await stripe.setupIntents.create({
    customer: customer.id,
    payment_method_types: ['card'],
  });
  setupIntent = await stripe.setupIntents.confirm(
    setupIntent.id,
    {
      payment_method: 'pm_card_visa',
    }
  )
  const paymentMethod = /** @type {string} */(setupIntent.payment_method)
  await stripe.customers.update(customer.id, { invoice_settings: { default_payment_method: paymentMethod } })
  return customer
}

test('stripe plan can be updated', async (t) => {
  const stripeSecretKey = process.env.STRIPE_TEST_SECRET_KEY
  if (stripeSecretKey) {
    const stripe = new Stripe(stripeSecretKey, { apiVersion: '2023-10-16' })
    const billingProvider = createStripeBillingProvider(stripe)
    const customerDID = /** @type {import('@web3-storage/did-mailto').DidMailto} */(
      `did:mailto:example.com:w3up-billing-test-${Date.now()}`
    )
    const email = toEmail(customerDID)

    const initialPlan = 'did:web:starter.dev.web3.storage'
    const updatedPlan = 'did:web:lite.dev.web3.storage'

    const prices = await stripe.prices.list({ lookup_keys: [initialPlan] })
    const initialPriceID = prices.data.find(price => price.lookup_key === initialPlan)?.id
    let customer
    try {
      // create a new customer and set up its subscription with "initialPlan"
      customer = await setupCustomer(stripe, email)
      
      // create a subscription to initialPlan
      await stripe.subscriptions.create({ customer: customer.id, items: [{ price: initialPriceID }] })

      // use the stripe API to verify plan has been initialized correctly
      const initialStripePlan = await getCustomerPlanByEmail(stripe, email)
      t.deepEqual(initialPlan, initialStripePlan)

      // this is the actual code under test!
      await billingProvider.setPlan(customerDID, updatedPlan)

      // use the stripe API to verify plan has been updated
      const updatedStripePlan = await getCustomerPlanByEmail(stripe, email)
      t.deepEqual(updatedPlan, updatedStripePlan)
    } finally {
      if (customer) {
        // clean up the user we created
        await stripe.customers.del(customer.id)
      }
    }
  } else {
    t.fail('STRIPE_TEST_SECRET_KEY environment variable is not set')
  }
})
