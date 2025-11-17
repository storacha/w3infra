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
 * Calculate the "billing cycle anchor" - ie, the start of the next month
 *
 * Ideally Stripe would do this, but the "billing_cycle_anchor_config" parameter
 * is apparently not available in the subscription_data property of the checkout
 * session creation data, sad.
 *
 * @returns {number} Unix timestamp (seconds since epoch) of the next billing cycle anchor
 */
function billingCycleAnchor() {
  const now = new Date()
  return Math.floor(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0, 0) / 1000
  )
}

/**
 * @param {import('stripe').Stripe} stripe
 * @param {import('../billing/lib/api.js').CustomerStore} customerStore
 * @param {import('./types.js').PlansToLineItems} plansToLineItemsMapping
 * @returns {import('./types.js').BillingProvider}
 */
export function createStripeBillingProvider(
  stripe,
  customerStore,
  plansToLineItemsMapping
) {
  return {
    /** @type {import('./types.js').BillingProvider['hasCustomer']} */
    async hasCustomer(customer) {
      const customersResponse = await stripe.customers.list({
        email: toEmail(
          /** @type {import('@storacha/did-mailto').DidMailto} */ (customer)
        ),
      })
      return { ok: customersResponse.data.length > 0 }
    },

    /** @type {import('./types.js').BillingProvider['setPlan']} */
    async setPlan(customerDID, plan) {
      /** @type {import('stripe').Stripe.SubscriptionItem[] | undefined} */
      let subscriptionItems
      /** @type {string | undefined} */
      let priceID
      try {
        const prices = await stripe.prices.list({ lookup_keys: [plan] })
        priceID = prices.data.find((price) => price.lookup_key === plan)?.id
        if (!priceID)
          return {
            error: new InvalidSubscriptionState(
              `could not find Stripe price with lookup_key ${plan} - cannot set plan`
            ),
          }

        const email = toEmail(
          /** @type {import('@storacha/did-mailto').DidMailto} */ (customerDID)
        )
        const customers = await stripe.customers.list({
          email,
          expand: ['data.subscriptions'],
        })
        if (customers.data.length !== 1)
          return {
            error: new InvalidSubscriptionState(
              `found ${customers.data.length} Stripe customer(s) with email ${email} - cannot set plan`
            ),
          }

        const customer = customers.data[0]
        const subscriptions = customer.subscriptions?.data
        if (subscriptions?.length !== 1)
          return {
            error: new InvalidSubscriptionState(
              `found ${subscriptions?.length} Stripe subscriptions(s) for customer with email ${email} - cannot set plan`
            ),
          }

        subscriptionItems = customer.subscriptions?.data[0].items.data
        if (subscriptionItems?.length !== 1)
          return {
            error: new InvalidSubscriptionState(
              `found ${subscriptionItems?.length} Stripe subscriptions item(s) for customer with email ${email} - cannot set plan`
            ),
          }
      } catch (/** @type {any} */ err) {
        return {
          error: new InvalidSubscriptionState(err.message, { cause: err }),
        }
      }

      try {
        await stripe.subscriptionItems.update(subscriptionItems[0].id, {
          price: priceID,
        })

        return { ok: {} }
      } catch (/** @type {any} */ err) {
        return {
          error: new BillingProviderUpdateError(err.message, { cause: err }),
        }
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
            cause: response.error,
          },
        }
      }
      if (!response.ok.account) {
        return {
          error: {
            name: 'CustomerNotFound',
            message: 'Customer account not set',
          },
        }
      }
      const customer = response.ok.account.slice('stripe:'.length)
      const session = await stripe.billingPortal.sessions.create({
        customer,
        return_url: returnURL,
      })
      return {
        ok: {
          url: session.url,
        },
      }
    },

    /**
     * Create a Stripe checkout session with the appropriate line items
     * for the given planID.
     *
     * @type {import('./types.js').BillingProvider['createCheckoutSession']}
     */
    async createCheckoutSession(account, planID, options) {
      const customerResponse = await customerStore.get({ customer: account })
      if (
        customerResponse.error &&
        customerResponse.error.name === 'RecordNotFound'
      ) {
        const lineItems = plansToLineItemsMapping[planID]
        if (!lineItems || lineItems.length === 0) {
          return {
            error: {
              name: 'PlanNotFound',
              message: `Could not find ${planID}`,
              cause: customerResponse.error,
            },
          }
        }
        /** @type {import('stripe').Stripe.Checkout.SessionCreateParams} */
        const sessionCreateParams = {
          mode: 'subscription',
          customer_email: DIDMailto.toEmail(
            /** @type {import('@storacha/did-mailto').DidMailto} */ (account)
          ),
          success_url: options.successURL,
          cancel_url: options.cancelURL,
          line_items: plansToLineItemsMapping[planID],
          subscription_data: {
            billing_cycle_anchor: billingCycleAnchor(),
            trial_period_days: options.freeTrial ? 30 : undefined,
          },
        }

        const session =
          await stripe.checkout.sessions.create(sessionCreateParams)
        if (!session.url) {
          return {
            error: {
              name: 'SessionCreationError',
              message: `Error creating session: did not receive URL from Stripe`,
            },
          }
        }
        return {
          ok: {
            url: session.url,
          },
        }
      } else if (customerResponse.ok) {
        return {
          error: {
            name: 'CustomerExists',
            message: `Sorry, ${account} is already a customer - cannot create another checkout session for them.`,
          },
        }
      } else {
        return {
          error: {
            name: 'UnexpectedError',
            message: `Unexpected error looking up ${account}`,
            cause: customerResponse.error,
          },
        }
      }
    },
  }
}
