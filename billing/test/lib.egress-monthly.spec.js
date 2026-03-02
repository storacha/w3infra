import * as EgressMonthlySuite from './lib/egress-monthly.js'
import { bindTestContext, createEgressMonthlyTestContext } from './helpers/context.js'

export const test = bindTestContext(EgressMonthlySuite.test, createEgressMonthlyTestContext)
