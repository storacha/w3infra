import * as Server from './server.js'
import * as CAR from '@ucanto/transport/car'
import * as CBOR from '@ucanto/transport/cbor'
import * as Sentry from '@sentry/serverless'

import { createStoreService } from './store/index.js'
import { createUploadService } from './upload/index.js'

Sentry.AWSLambda.init({
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 1.0,
})

/**
 * @param {import('./types').UcantoServiceContext} context
 * @returns {import('./types').Service}
 */
export function createServiceRouter (context) {
  return {
    store: createStoreService(context),
    upload: createUploadService(context)
  }
}

/**
 * @param {import('@ucanto/interface').Signer} serviceSigner
 * @param {import('../service/types').UcantoServerContext} serverContext
 * @param {import('../service/types').UcantoServiceContext} serviceContext
 */
 export async function createUcantoServer (serviceSigner, serverContext, serviceContext) {
  const server = Server.create({
    id: serviceSigner,
    encoder: CBOR,
    decoder: CAR,
    service: createServiceRouter(serviceContext),
    ...serverContext,
    catch: (/** @type {string | Error} */ err) => {
      console.warn(err)
      Sentry.AWSLambda.captureException(err)
    },
  })

  return server
}
