import * as Server from '@ucanto/server'
import * as CAR from '@ucanto/transport/car'
import * as CBOR from '@ucanto/transport/cbor'
import * as Sentry from '@sentry/serverless'

import { createInvocationService } from './invocation/index.js'

Sentry.AWSLambda.init({
  environment: process.env.SST_STAGE,
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 1.0,
})

/**
 * @param {import('./types').UcantoServerContext} context
 * @returns {import('./types').Service}
 */
export function createServiceRouter (context) {
  return {
    invocation: createInvocationService(context),
  }
}

/**
 * @param {import('@ucanto/interface').Signer} servicePrincipal
 * @param {import('./types').UcantoServerContext} context
 */
export const createUcantoServer = (servicePrincipal, context) => {

}
