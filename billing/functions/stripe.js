import { UpdateItemCommand } from '@aws-sdk/client-dynamodb'
import * as Sentry from '@sentry/serverless'
import { Config } from '@serverless-stack/node/config/index.js'
import Stripe from 'stripe'
import { connectTable } from '../tables/client'

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
    if (!request.body){
      return {
        statusCode: 400,
        body: 'Cannot process webhook request: it has no body'
      }
    }
    if (!request.headers['stripe-signature']){
      return {
        statusCode: 400,
        body: 'Cannot process webhook request: it has no stripe-signature header'
      }
    }

    // try to set up the stripe client from secrets
    const customContext = context?.clientContext?.Custom
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
    
    let event;
    try {
      // construct the event - this will throw an error if the signature is incorrect
      event = stripe.webhooks.constructEvent(
        request.body, request.headers['stripe-signature'], stripeEndpointSecret
      )

      if (event.type === 'checkout.session.completed') {
        const email = event.data.object.customer_email
        const stripeId = event.data.object.customer
        // TODO: we need to ensure that the customer record matching the 
        // customer email is updated to include the stripeId    
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


