import { Failure } from '@ucanto/core'
import { toEmail } from '@storacha/did-mailto'
import { DIDMailto } from '@storacha/client/capability/access'

export class InvalidSubscriptionState extends Failure {
  /**
   * @param {string} [message] Context for the message.
   * @param {ErrorOptions} [options]
   */
  constructor(message, options) {
    super(undefined, options)
    this.name = /** @type {const} */ ('InvalidSubscriptionState')
    this.detail = message
  }

  describe() {
    return `subscription cannot be updated because it is not in a valid state: ${this.detail}`
  }
}

export class BillingProviderUpdateError extends Failure {
  /**
   * @param {string} [message] Context for the message.
   * @param {ErrorOptions} [options]
   */
  constructor(message, options) {
    super(undefined, options)
    this.name = /** @type {const} */ ('BillingProviderUpdateError')
    this.detail = message
  }

  describe() {
    return `encountered an error updating subscription: ${this.detail}`
  }
}

/**
 * @type Record<string, import('stripe').Stripe.Checkout.SessionCreateParams.LineItem[]>
 * 
 * TODO: populate this with all plans and use the correct prod prices OR pull them out to an env var
 */
const PLANS_TO_LINE_ITEMS = {
  'did:web:starter.storacha.network': [
    // flat fee
    {
      price: 'price_1SJMcVF6A5ufQX5voRJSNUWT',
      quantity: 1
    },
    // storage
    {
      price: 'price_1SJMfPF6A5ufQX5vdfInsdls',
    },
    // egress
    {
      price: 'price_1SJMgMF6A5ufQX5vVX927Uvx',
    },
  ],
    'did:web:lite.storacha.network': [
    // flat fee
    {
      price: 'price_1SKRC5F6A5ufQX5vRpsfsnAV',
      quantity: 1
    },
    // storage
    {
      price: 'price_1SKRFHF6A5ufQX5vE4YQ0dk2',
    },
    // egress
    {
      price: 'price_1SKRGrF6A5ufQX5v2XXj8FwQ',
    },
  ],
    'did:web:business.storacha.network': [
    // flat fee
    {
      price: 'price_1SKRJSF6A5ufQX5vXZrDTvW8',
      quantity: 1
    },
    // storage
    {
      price: 'price_1SKRRkF6A5ufQX5vLlfGHtG1',
    },
    // egress
    {
      price: 'price_1SKRWCF6A5ufQX5vlkNUeTBz',
    },
  ]
}

/**
 * 
 * @param {import('@storacha/upload-api').PlanID} planID 
 * @returns string[] | null
 */
function plansToLineItems(planID) {
  return PLANS_TO_LINE_ITEMS[planID]
}

/**
 * @param {import('stripe').Stripe} stripe
 * @param {import('../billing/lib/api.js').CustomerStore} customerStore
 * @returns {import('./types.js').BillingProvider}
 */
export function createStripeBillingProvider(stripe, customerStore) {
  return {
    /** @type {import('./types.js').BillingProvider['hasCustomer']} */
    async hasCustomer(customer) {
      const customersResponse = await stripe.customers.list({ email: toEmail(/** @type {import('@storacha/did-mailto').DidMailto} */(customer)) })
      return { ok: (customersResponse.data.length > 0) }
    },

    /** @type {import('./types.js').BillingProvider['setPlan']} */
    async setPlan(customerDID, plan) {
      /** @type {import('stripe').Stripe.SubscriptionItem[] | undefined} */
      let subscriptionItems
      /** @type {string | undefined} */
      let priceID
      try {
        const prices = await stripe.prices.list({ lookup_keys: [plan] })
        priceID = prices.data.find(price => price.lookup_key === plan)?.id
        if (!priceID) return (
          { error: new InvalidSubscriptionState(`could not find Stripe price with lookup_key ${plan} - cannot set plan`) }
        )

        const email = toEmail(/** @type {import('@storacha/did-mailto').DidMailto} */(customerDID))
        const customers = await stripe.customers.list({ email, expand: ['data.subscriptions'] })
        if (customers.data.length !== 1) return (
          { error: new InvalidSubscriptionState(`found ${customers.data.length} Stripe customer(s) with email ${email} - cannot set plan`) }
        )

        const customer = customers.data[0]
        const subscriptions = customer.subscriptions?.data
        if (subscriptions?.length !== 1) return (
          { error: new InvalidSubscriptionState(`found ${subscriptions?.length} Stripe subscriptions(s) for customer with email ${email} - cannot set plan`) }
        )

        subscriptionItems = customer.subscriptions?.data[0].items.data
        if (subscriptionItems?.length !== 1) return (
          { error: new InvalidSubscriptionState(`found ${subscriptionItems?.length} Stripe subscriptions item(s) for customer with email ${email} - cannot set plan`) }
        )
      } catch (/** @type {any} */ err) {
        return { error: new InvalidSubscriptionState(err.message, { cause: err }) }
      }

      try {
        await stripe.subscriptionItems.update(subscriptionItems[0].id, { price: priceID })

        return { ok: {} }
      } catch (/** @type {any} */ err) {
        return { error: new BillingProviderUpdateError(err.message, { cause: err }) }
      }
    },

    /** @type {import('./types.js').BillingProvider['createAdminSession']} */
    async createAdminSession(account, returnURL) {
      const response = await customerStore.get({ customer: account })
      if (response.error) {
        return {
          error: {
            name: 'CustomerNotFound',
            message: 'Error getting customer',
            cause: response.error
          }
        }
      }
      if (!response.ok.account) {
        return {
          error: {
            name: 'CustomerNotFound',
            message: 'Customer account not set'
          }
        }
      }
      const customer = response.ok.account.slice('stripe:'.length)
      const session = await stripe.billingPortal.sessions.create({
        customer,
        return_url: returnURL
      })
      return {
        ok: {
          url: session.url
        }
      }
    },

    /** 
     * Create a Stripe checkout session with the appropriate line items
     * for the given planID.
     * 
     * TODO: handle free trials
     * 
     * @type {import('./types.js').BillingProvider['createCheckoutSession']}
     */
    async createCheckoutSession(account, planID, options) {
      const response = await customerStore.get({ customer: account })
      const customer = response.ok?.account?.slice('stripe:'.length)
      const lineItems = plansToLineItems(planID)
      if (lineItems.length === 0) {
        return {
          error: {
            name: 'PlanNotFound',
            message: `Could not find ${planID}`,
            cause: response.error
          }
        }
      }
      /** @type {import('stripe').Stripe.Checkout.SessionCreateParams} */
      const sessionCreateParams = {
        mode: 'subscription',
        // if the customer exists already, pass it here so Stripe doesn't create a duplicate user
        customer: customer,
        customer_email: DIDMailto.toEmail(/** @type {import('@storacha/did-mailto').DidMailto} */(account)),
        success_url: options.successURL,
        cancel_url: options.cancelURL,
        line_items: plansToLineItems(planID)
      }
      console.log("OPTOINS", options)
      if (options.freeTrial) {
        console.log("FREE TRIAL!!!")
        sessionCreateParams.subscription_data = {
          trial_period_days: 30
        }
      }

      const session = await stripe.checkout.sessions.create(sessionCreateParams)
      if (!session.url) {
        return {
          error: {
            name: 'SessionCreationError',
            message: `Error creating session: did not receive URL from Stripe`,
          }
        }
      }
      return {
        ok: {
          url: session.url
        }
      }
    }
  }
}