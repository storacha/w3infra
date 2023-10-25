import * as BillingCron from './lib/billing-cron.js'
import { bindTestContext, createBillingCronTestContext } from './helpers/context.js'

export const test = bindTestContext(BillingCron.test, createBillingCronTestContext)
