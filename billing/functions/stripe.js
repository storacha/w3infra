import * as Sentry from '@sentry/serverless'
import { Config } from 'sst/node/config'
import Stripe from 'stripe'
import { expect } from './lib.js'
import { createCustomerStore } from '../tables/customer.js'
import { handleCustomerSubscriptionCreated } from '../utils/stripe.js'
import { mustGetEnv } from '../../lib/env.js'
import { PRICES_TO_PLANS_MAPPING } from '../../upload-api/constants.js'

/**
 * @typedef {import('../lib/api.js').AccountID} AccountID
 */

Sentry.AWSLambda.init({
  environment: process.env.SST_STAGE,
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 0,
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
    const stripe = new Stripe(stripeSecretKey, { apiVersion: '2025-02-24.acacia' })

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
      const storachaEnv = mustGetEnv('SST_STAGE')
      const pricesToPlans = PRICES_TO_PLANS_MAPPING[storachaEnv]
      // TODO: move this out to a separate lambda per best practices here: https://stripe.com/docs/webhooks#acknowledge-events-immediately
      expect(
        await handleCustomerSubscriptionCreated(stripe, event, customerStore, pricesToPlans),
        'handling customer subscription created Stripe event'
      )
    }
  }
)
