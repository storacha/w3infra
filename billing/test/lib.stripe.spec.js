import * as Stripe from './lib/stripe.js'
import { bindTestContext, createStripeTestContext } from './helpers/context.js'

export const test = bindTestContext(Stripe.test, createStripeTestContext)
