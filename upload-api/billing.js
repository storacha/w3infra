import { Failure, error } from '@ucanto/core'
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
 * @param {Record<string, string?>} couponIds
 * @returns {import('./types.js').BillingProvider}
 */
export function createStripeBillingProvider(
  stripe,
  customerStore,
  plansToLineItemsMapping,
  couponIds
) {
  return {
    /** @type {import('./types.js').BillingProvider['hasCustomer']} */
    async hasCustomer(customer) {
      const customersResponse = await stripe.customers.list({
        email: toEmail(
          /** @type {import('@storacha/did-mailto').DidMailto} */(customer)
        ),
      })
      return { ok: customersResponse.data.length > 0 }
    },

    /** @type {import('./types.js').BillingProvider['setPlan']} */
    async setPlan(customerDID, plan) {
      /** @type {import('stripe').Stripe.SubscriptionItem[] | undefined} */
      let subscriptionItems
      let subscription
      try {
        const cusRes = await customerStore.get({ customer: customerDID })
        if (cusRes.error) {
          return error(new InvalidSubscriptionState(`failed to get customer from store: ${cusRes.error.message}`))
        }

        const stripeID = cusRes.ok.account ?? ''
        if (!stripeID.startsWith('stripe:')) {
          return error(new InvalidSubscriptionState(`customer does not have a Stripe account: ${customerDID}`))
        }

        let customer
        try {
          const cust = await stripe.customers.retrieve(
            stripeID.replace('stripe:', ''),
            { expand: ['subscriptions'] }
          )
          if (cust.deleted) {
            return error(new InvalidSubscriptionState(`Stripe customer is deleted: ${customerDID}`))
          }
          customer = cust
        } catch (/** @type {any} */ err) {
          return error(new InvalidSubscriptionState(`failed to get customer ${customerDID} from Stripe by ID: ${err.message}`))
        }

        const subscriptions = customer.subscriptions?.data
        if (subscriptions?.length !== 1)
          return {
            error: new InvalidSubscriptionState(
              `found ${subscriptions?.length} Stripe subscriptions(s) for customer ${customerDID} - cannot set plan`
            ),
          }
        subscription = customer.subscriptions?.data[0]
        subscriptionItems = subscription?.items.data

      } catch (/** @type {any} */ err) {
        return {
          error: new InvalidSubscriptionState(err.message, { cause: err }),
        }
      }

      try {
        if (subscription) {
          /** @type {import('stripe').Stripe.SubscriptionItem[]} */
          const oldItems = subscriptionItems || []
          /** @type {import('stripe').Stripe.SubscriptionUpdateParams.Item[]} */
          const newItems = plansToLineItemsMapping[plan]
          await stripe.subscriptions.update(
            subscription.id,
            {
              items: [
                ...(oldItems?.map(si => ({ id: si.id, deleted: true }))),
                ...newItems              
              ]
            }
          )
        } else {
          return {
            error: new BillingProviderUpdateError(`Could not find subscription for ${customerDID}`)
          }
        }

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
            /** @type {import('@storacha/did-mailto').DidMailto} */(account)
          ),
          success_url: options.successURL || process.env.STRIPE_DEFAULT_SUCCESS_URL,
          cancel_url: options.cancelURL,
          line_items: plansToLineItemsMapping[planID],
          subscription_data: {
            billing_cycle_anchor: billingCycleAnchor(),
          },
        }

        if (options.freeTrial) {
          const couponID = couponIds[planID]
          if (couponID) {
            sessionCreateParams.discounts = [{
              coupon: couponID
            }]
          }
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
