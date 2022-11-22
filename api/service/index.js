import * as Server from '@ucanto/server'
import * as CAR from '@ucanto/transport/car'
import * as CBOR from '@ucanto/transport/cbor'

import { createStoreService } from './store/index.js'
import { createUploadService } from './upload/index.js'

/**
 * @param {import('./types').UcantoServerContext} context
 * @returns {Record<string, any>}
 */
export function createServiceRouter (context) {
  return {
    store: createStoreService(context),
    upload: createUploadService(context)
  }
}

/**
 * @param {import('@ucanto/interface').Signer} serviceSigner
 * @param {import('../service/types').UcantoServerContext} context
 */
 export async function createUcantoServer (serviceSigner, context) {
  const server = Server.create({
    id: serviceSigner,
    encoder: CBOR,
    decoder: CAR,
    service: createServiceRouter(context),
    catch: (/** @type {string | Error} */ err) => {
      // TODO: We need sentry to log stuff
      console.log('reporting error to sentry', err)
    },
  })

  return server
}