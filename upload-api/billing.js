import { Failure } from '@ucanto/core'
import { toEmail } from '@web3-storage/did-mailto'

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
 * 
 * @param {import('stripe').Stripe} stripe 
 * @returns {import("./types").BillingProvider}
 */
export function createStripeBillingProvider(stripe) {
  return {
    async hasCustomer(customer) {
      const customersResponse = await stripe.customers.list({ email: toEmail(/** @type {import('@web3-storage/did-mailto').DidMailto} */(customer)) })
      return { ok: (customersResponse.data.length > 0) }
    },

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

        const email = toEmail(/** @type {import('@web3-storage/did-mailto').DidMailto} */(customerDID))
        const customers = await stripe.customers.list({ email, expand: ['data.subscriptions'] })
        if (customers.data.length != 1) return (
          { error: new InvalidSubscriptionState(`found ${customers.data.length} Stripe customer(s) with email ${email} - cannot set plan`) }
        )

        const customer = customers.data[0]
        const subscriptions = customer.subscriptions?.data
        if (subscriptions?.length != 1) return (
          { error: new InvalidSubscriptionState(`found ${subscriptions?.length} Stripe subscriptions(s) for customer with email ${email} - cannot set plan`) }
        )

        subscriptionItems = customer.subscriptions?.data[0].items.data
        if (subscriptionItems?.length != 1) return (
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
    }
  }
}