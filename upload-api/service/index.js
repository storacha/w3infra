import * as Server from '@ucanto/server'
import * as CAR from '@ucanto/transport/car'
import * as CBOR from '@ucanto/transport/cbor'
import * as Sentry from '@sentry/serverless'

import { createStoreService } from './store/index.js'
import { createUploadService } from './upload/index.js'

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
    store: createStoreService(context),
    upload: createUploadService(context)
  }
}

/**
 * @param {import('@ucanto/interface').Principal} servicePrincipal
 * @param {import('../service/types').UcantoServerContext} context
 */
export async function createUcantoServer (servicePrincipal, context) {
  const server = Server.create({
    id: servicePrincipal,
    encoder: CBOR,
    decoder: CAR,
    service: createServiceRouter(context),
    catch: (/** @type {string | Error} */ err) => {
      console.warn(err)
      Sentry.AWSLambda.captureException(err)
    },
  })

  return server
}
