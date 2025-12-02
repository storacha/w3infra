import { createStripeBillingProvider } from '../billing.js'
import { test } from './helpers/context.js'
import { toEmail } from '@storacha/did-mailto'
import dotenv from 'dotenv'

import Stripe from 'stripe'
import { fileURLToPath } from 'node:url'
import { createCustomerStore, customerTableProps } from '../../billing/tables/customer.js'
import { createTable } from './helpers/resources.js'
import { createDynamoDB } from '../../billing/test/helpers/aws.js'
import { stripeIDToAccountID } from '../../billing/utils/stripe.js'
import { FREE_TRIAL_COUPONS, PLANS_TO_LINE_ITEMS_MAPPING } from '../constants.js'

dotenv.config({ path: fileURLToPath(new URL('../../.env.local', import.meta.url)) })

/** @import { DidMailto as AccountDID } from '@storacha/did-mailto' */

/**
 * @typedef {object} BillingContext
 * @property {import('../../billing/lib/api.js').CustomerStore} BillingContext.customerStore
 * @property {Stripe} BillingContext.stripe
 * @property {import('../types.js').BillingProvider} BillingContext.billingProvider
 */

/** @returns {AccountDID} */
const randomAccount = () => `did:mailto:example.com:w3up-billing-test-${Date.now()}`
const initialPlan = 'did:web:starter.storacha.network'

/**
 * 
 * @param {Stripe} stripe 
 * @param {string} email 
 * @returns {Promise<string[] | undefined>}
 */
async function getCustomerSubscriptionPricesByEmail(stripe, email) {
  const customers = await stripe.customers.list({ email, expand: ['data.subscriptions'] })
  if (customers.data.length > 1) throw new Error(`found more than one customer with email ${email}`)
  const customer = customers.data[0]
  if (customer) {
    return customer.subscriptions?.data[0].items.data.map(i => i.price.id)
  }
}

/**
 * @param {Stripe} stripe
 * @param {AccountDID} account
 * @param {import('../../billing/lib/api.js').CustomerStore} customerStore
 * @returns {Promise<Stripe.Customer>}
 */
async function setupCustomer(stripe, account, customerStore) {
  const email = toEmail(account)
  const customer = await stripe.customers.create({ email })
  const customerCreation = await customerStore.put({
    customer: account,
    account: stripeIDToAccountID(customer.id),
    product: initialPlan,
    insertedAt: new Date()
  })
  if (!customerCreation.ok) {
    throw customerCreation.error
  }

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
  await stripe.subscriptions.create({
     customer: customer.id, 
     // @ts-expect-error type conversion error here but it should be harmless
     items: PLANS_TO_LINE_ITEMS_MAPPING.staging[initialPlan] || [] 
    })
  return customer
}

/**
 * 
 * @param {BillingContext} context 
 * @param {(c: BillingContext & { account: AccountDID, customer: Stripe.Customer }) => Promise<void>} testFn 
 */
async function withCustomer(context, testFn) {
  const { stripe, customerStore } = context
  let customer
  try {
    const account = randomAccount()
    // create a new customer and set up its subscription with "initialPlan"
    customer = await setupCustomer(stripe, account, customerStore)
    await testFn({ ...context, account, customer })
  } finally {
    if (customer) {
      // clean up the user we created
      await stripe.customers.del(customer.id)
    }
  }
}

test.before(async t => {
  const stripeSecretKey = process.env.STRIPE_TEST_SECRET_KEY

  if (!stripeSecretKey) {
    throw new Error('STRIPE_TEST_SECRET_KEY environment variable is not set')
  }
  const { client: dynamo } = await createDynamoDB()

  const stripe = new Stripe(stripeSecretKey, { apiVersion: '2025-02-24.acacia' })

  const customerStore = createCustomerStore(dynamo, { tableName: await createTable(dynamo, customerTableProps) })
  // use the staging config in test because staging points at the Stripe sandbox
  const plansToLineItemsMapping = PLANS_TO_LINE_ITEMS_MAPPING.staging
  const couponIds = FREE_TRIAL_COUPONS.staging
  const billingProvider = createStripeBillingProvider(stripe, customerStore, plansToLineItemsMapping, couponIds)

  Object.assign(t.context, {
    dynamo,
    customerStore,
    stripe,
    billingProvider
  })
})

/**
 * 
 * @param {string} planID 
 */
function expectedPriceIdsByPlanId(planID){
  return PLANS_TO_LINE_ITEMS_MAPPING.staging[planID].map(i => i.price)
}

test('stripe plan can be updated', async (t) => {
  const context = /** @type {typeof t.context & BillingContext } */(t.context)
  const { stripe, billingProvider } = context

  await withCustomer(context, async ({ account }) => {
    // use the stripe API to verify plan has been initialized correctly
    const initialStripePrices = await getCustomerSubscriptionPricesByEmail(stripe, toEmail(account))
    t.deepEqual(expectedPriceIdsByPlanId(initialPlan), initialStripePrices)

    // this is the actual code under test!
    const updatedPlan = 'did:web:lite.storacha.network'
    const result = await billingProvider.setPlan(account, updatedPlan)
    console.log(result)
    t.assert(result.ok)

    // use the stripe API to verify plan has been updated
    const updatedStripePrices = await getCustomerSubscriptionPricesByEmail(stripe, toEmail(account))
    t.deepEqual(expectedPriceIdsByPlanId(updatedPlan), updatedStripePrices)
  })
})

test('stripe plan can be updated when customer has updated their email address', async (t) => {
  const context = /** @type {typeof t.context & BillingContext } */(t.context)
  const { stripe, billingProvider } = context

  await withCustomer(context, async ({ customer, account }) => {
    const updatedEmail = toEmail(randomAccount())
    await stripe.customers.update(customer.id, { email: updatedEmail })

    const updatedPlan = 'did:web:lite.storacha.network'
    // use the account ID with the old email
    const result = await billingProvider.setPlan(account, updatedPlan)
    console.log(result)
    t.assert(result.ok)

    // use the stripe API to verify plan has been updated
    const updatedStripePrices = await getCustomerSubscriptionPricesByEmail(stripe, toEmail(account))
    t.deepEqual(expectedPriceIdsByPlanId(updatedPlan), updatedStripePrices)
  })
})

test('stripe billing admin session can be generated', async (t) => {
  const context = /** @type {typeof t.context & BillingContext } */(t.context)
  const { billingProvider } = context

  await withCustomer(context, async ({ account }) => {
    const response = await billingProvider.createAdminSession(account, 'https://example.com/return-url')
    t.assert(response.ok)
    t.assert(response.ok?.url)
  })
})

test('stripe checkout session can be generated', async (t) => {
  const context = /** @type {typeof t.context & BillingContext } */(t.context)
  const { billingProvider } = context

  await withCustomer(context, async ({ account }) => {
    const response = await billingProvider.createCheckoutSession(
      account,
      'did:web:starter.storacha.network',
      {
        successURL: 'https://example.com/return-url',
        cancelURL: 'https://example.com/cancel-url'
      })
    t.assert(response.error)
    t.is(response.error?.name, 'CustomerExists')
  })

  const response = await billingProvider.createCheckoutSession(
    'did:mailto:example.com:notacustomer',
    'did:web:starter.storacha.network',
    {
      successURL: 'https://example.com/return-url',
      cancelURL: 'https://example.com/cancel-url'
    })
  t.assert(response.ok)
  t.assert(response.ok?.url)
})