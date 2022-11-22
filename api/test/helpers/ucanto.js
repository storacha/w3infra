import * as UcantoClient from '@ucanto/client'
import { CAR, CBOR } from '@ucanto/transport'
import * as Signer from '@ucanto/principal/ed25519'

import { createUcantoServer } from '../../service/index.js'
import { createCarStore } from '../../buckets/car-store.js'
import { createStoreTable } from '../../tables/store.js'
import { createUploadTable } from '../../tables/upload.js'
import { createSigner } from '../../signer.js'

import { getSigningOptions } from '../utils.js'
import { createAccessClient } from '../../access.js'

/** @typedef {import('@ucanto/interface').Principal} Principal */

/**
 * @param {Principal} service
 * @param {import('./context.js').UcantoServerContext} ctx
 */
export function createTestingUcantoServer(service, ctx) {
 return createUcantoServer(service, {
   storeTable: createStoreTable(ctx.region, ctx.tableName, {
     endpoint: ctx.dbEndpoint
   }),
   uploadTable: createUploadTable(ctx.region, ctx.tableName, {
     endpoint: ctx.dbEndpoint
   }),
   carStoreBucket: createCarStore(ctx.region, ctx.bucketName, { ...ctx.s3ClientOpts }),
   signer: createSigner(getSigningOptions(ctx)),
   access: createAccessClient(service, ctx.access.servicePrincipal, ctx.access.serviceURL)
 })
}

/**
 * @param {Principal} service 
 * @param {any} context 
 * @returns 
 */
export async function getClientConnection (service, context) {
  return UcantoClient.connect({
    id: service,
    encoder: CAR,
    decoder: CBOR,
    channel: await createTestingUcantoServer(service, context),
  })
}

/**
 * @param {Principal} audience
 */
export async function createSpace (audience) {
  const space = await Signer.generate()
  const spaceDid = space.did()

  return {
    proof: await UcantoClient.delegate({
      issuer: space,
      audience,
      capabilities: [{ can: '*', with: spaceDid }]
    }),
    spaceDid
  }
}
