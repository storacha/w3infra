import * as EgressTrafficQueue from './lib/egress-traffic-queue.js'
import { bindTestContext, createEgressTrafficQueueTestContext } from './helpers/context.js'

export const test = bindTestContext(EgressTrafficQueue.test, createEgressTrafficQueueTestContext)