import * as Sentry from '@sentry/serverless'
import { Config } from '@serverless-stack/node/config/index.js'
import Stripe from 'stripe'
import * as DidMailto from '@web3-storage/did-mailto'
import { mustGetEnv } from './lib.js'
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

    // try to set up the stripe client from secrets
    const customContext = context?.clientContext?.Custom
    const region = customContext?.region ?? mustGetEnv('AWS_REGION')
    const customerTable = customContext?.customerTable ?? mustGetEnv('CUSTOMER_TABLE_NAME')
    const stripeSecretKey = customContext?.stripeSecretKey ?? Config.STRIPE_SECRET_KEY
    if (!stripeSecretKey) throw new Error('missing secret: STRIPE_SECRET_KEY')
    const stripeEndpointSecret = customContext?.stripeEndpointSecret ?? Config.STRIPE_ENDPOINT_SECRET
    if (!stripeSecretKey) throw new Error('missing secret: STRIPE_ENDPOINT_SECRET')
    if (!(stripeEndpointSecret && stripeSecretKey)) {
      return {
        statusCode: 500,
        body: 'Stripe configuration incomplete'
      }
    }
    const stripe = new Stripe(stripeSecretKey, { apiVersion: '2023-10-16' })
    const customerStore = createCustomerStore({ region }, { tableName: customerTable })

    let event;
    try {
      // construct the event - this will throw an error if the signature is incorrect
      event = stripe.webhooks.constructEvent(
        request.body, request.headers['stripe-signature'], stripeEndpointSecret
      )

      if (event.type === 'customer.created') {
        if (event.data.object.email) {
          customerStore.put({
            customer: DidMailto.fromEmail(/** @type {`${string}@${string}`} */(event.data.object.email)),
            account: /** @type {AccountID} */(`stripe:${event.data.object.id}`),
            insertedAt: new Date(),
            updatedAt: new Date()
          })
        } else {
          console.error(`received customer.created from Stripe for customer ${event.data.object.id} with email`)
          return {
            statusCode: 400,
            body: `customer.created but no email for ${event.data.object.id}`
          }
        }
      } else if (event.type === 'customer.subscription.created') {
        const account = /** @type {AccountID} */(`stripe:${event.data.object.customer}`)
        customerStore.updateProductForAccount(
          account,
          // this can technically be a Product object, but not in the context of webhooks, so this cast is safe
          /** @type {string} */(event.data.object.items.data[0].price.product)
        )
      }
    } catch (/** @type {any} */ err) {
      return {
        statusCode: 400,
        body: `Webhook Error: ${err.message}`
      }
    }

    return {
      statusCode: 200
    }
  }
)


