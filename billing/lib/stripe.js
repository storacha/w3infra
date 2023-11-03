import * as Ucanto from '@ucanto/interface'
import * as DidMailto from '@web3-storage/did-mailto'
import Stripe from 'stripe'

/**
 * @typedef {import('../lib/api.js').AccountID} AccountID
 */

/**
 *
 * @param {Stripe} stripe
 * @param {Stripe.CustomerSubscriptionCreatedEvent} event
 * @param {import('./api.js').CustomerStore} customerStore
 * @returns {Promise<Ucanto.Result<Ucanto.Unit, Ucanto.Failure>>}
 */
export async function handleCustomerSubscriptionCreated(stripe, event, customerStore) {
  // per https://stripe.com/docs/expand#with-webhooks these attributes will always be a string in a webhook, so these typecasts are safe
  const customerId = String(event.data.object.customer)
  const product = String(event.data.object.items.data[0].price.product)
  const account = /** @type {AccountID} */ (`stripe:${customerId}`)
  const stripeCustomer = await stripe.customers.retrieve(customerId)
  if (stripeCustomer.deleted) {
    return {
      error: new Error(`Could not update subscription information - user appears to have been deleted`)
    }
  } else {
    const customer = DidMailto.fromEmail(/** @type {`${string}@${string}`} */(
      stripeCustomer.email
    ))

    return customerStore.put({
      customer,
      account,
      product,
      insertedAt: new Date(),
      updatedAt: new Date()
    })
  }
}
