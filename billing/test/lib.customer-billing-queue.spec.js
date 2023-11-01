import * as CustomerBillingQueue from './lib/customer-billing-queue.js'
import { bindTestContext, createCustomerBillingQueueTestContext } from './helpers/context.js'

export const test = bindTestContext(CustomerBillingQueue.test, createCustomerBillingQueueTestContext)