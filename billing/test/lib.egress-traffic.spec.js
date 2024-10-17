import * as EgressTrafficSuite from './lib/egress-traffic.js'
import { bindTestContext, createEgressTrafficTestContext } from './helpers/context.js'

export const test = bindTestContext(EgressTrafficSuite.test, createEgressTrafficTestContext)