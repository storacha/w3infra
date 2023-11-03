import * as DidMailto from '@web3-storage/did-mailto'

/**
 * @typedef {import('../lib/api.js').AccountID} AccountID
 * @typedef {import('stripe').Stripe} Stripe
 * @typedef {import('stripe').Stripe.CustomerSubscriptionCreatedEvent} CustomerSubscriptionCreatedEvent
 */

/**
 *
 * @param {Stripe} stripe
 * @param {CustomerSubscriptionCreatedEvent} event
 * @param {import('../lib/api.js').CustomerStore} customerStore
 * @returns {Promise<import('@ucanto/interface').Result<import('@ucanto/interface').Unit, import('@ucanto/interface').Failure>>}
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
