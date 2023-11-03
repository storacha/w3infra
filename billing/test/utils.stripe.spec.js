import * as Stripe from './utils/stripe.js'
import { bindTestContext, createStripeTestContext } from './helpers/context.js'

export const test = bindTestContext(Stripe.test, createStripeTestContext)
