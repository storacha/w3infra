import * as Sentry from '@sentry/serverless'
import { Config } from '@serverless-stack/node/config/index.js'
import * as DidMailto from '@web3-storage/did-mailto'
import Stripe from 'stripe'
import { expect, mustGetEnv } from './lib.js'
import { createCustomerStore } from '../tables/customer.js'

/**
 * @typedef {import('../lib/api.js').AccountID} AccountID
 */

Sentry.AWSLambda.init({
  environment: process.env.SST_STAGE,
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 1.0,
})

export const webhook = Sentry.AWSLambda.wrapHandler(
  /**
   * AWS HTTP Gateway handler for POST /stripe
   *
   * @param {import('aws-lambda').APIGatewayProxyEventV2} request
   * @param {import('aws-lambda').Context} context
   */
  async (request, context) => {
    // ensure request has a body and is signed
    if (!request.body) {
      return {
        statusCode: 400,
        body: 'Cannot process webhook request: it has no body'
      }
    }
    if (!request.headers['stripe-signature']) {
      return {
        statusCode: 400,
        body: 'Cannot process webhook request: it has no stripe-signature header'
      }
    }

    const customContext = context?.clientContext?.Custom

    const stripeSecretKey = customContext?.stripeSecretKey ?? Config.STRIPE_SECRET_KEY
    if (!stripeSecretKey) throw new Error('missing secret: STRIPE_SECRET_KEY')
    const stripe = new Stripe(stripeSecretKey, { apiVersion: '2023-10-16' })

    // construct the event object - constructEvent will throw an error if the signature is incorrect
    const stripeEndpointSecret = customContext?.stripeEndpointSecret ?? Config.STRIPE_ENDPOINT_SECRET
    if (!stripeEndpointSecret) throw new Error('missing secret: STRIPE_ENDPOINT_SECRET')
    const event = stripe.webhooks.constructEvent(
      request.body, request.headers['stripe-signature'], stripeEndpointSecret
    )

    if (event.type === 'customer.subscription.created') {
      const region = customContext?.region ?? mustGetEnv('AWS_REGION')
      const customerTable = customContext?.customerTable ?? mustGetEnv('CUSTOMER_TABLE_NAME')
      const customerStore = createCustomerStore({ region }, { tableName: customerTable })
      // TODO: move this out to a separate lambda per best practices here: https://stripe.com/docs/webhooks#acknowledge-events-immediately
      expect(
        await handleCustomerSubscriptionCreated(stripe, event, customerStore),
        'handling customer subscription created Stripe event'
      )
    }
  }
)

/**
 *
 * @param {Stripe} stripe
 * @param {Stripe.CustomerSubscriptionCreatedEvent} event
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
