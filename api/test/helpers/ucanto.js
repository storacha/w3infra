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

/**
 * @typedef {object} ResourcesMetadata
 * @property {string} region
 * @property {string} tableName
 * @property {string} bucketName
 */

/**
 * @param {import('@ucanto/interface').Signer} service
 * @param {import('./context.js').UcantoServerContext} ctx
 * @param {ResourcesMetadata} resourcesMetadata
 */
export function createTestingUcantoServer(service, ctx, resourcesMetadata) {
 return createUcantoServer(service, {
   storeTable: createStoreTable(resourcesMetadata.region, resourcesMetadata.tableName, {
     endpoint: ctx.dbEndpoint
   }),
   uploadTable: createUploadTable(resourcesMetadata.region, resourcesMetadata.tableName, {
     endpoint: ctx.dbEndpoint
   }),
   carStoreBucket: createCarStore(resourcesMetadata.region, resourcesMetadata.bucketName, { ...ctx.s3ClientOpts }),
   signer: createSigner(getSigningOptions(ctx, resourcesMetadata)),
   access: createAccessClient(service, ctx.access.servicePrincipal, ctx.access.serviceURL)
 })
}

/**
 * @param {import('@ucanto/interface').Signer} service
 * @param {any} context 
 * @param {ResourcesMetadata} resourcesMetadata
 * @returns 
 */
export async function getClientConnection (service, context, resourcesMetadata) {
  return UcantoClient.connect({
    id: service,
    encoder: CAR,
    decoder: CBOR,
    channel: await createTestingUcantoServer(service, context, resourcesMetadata),
  })
}

/**
 * @param {import('@ucanto/interface').Principal} audience
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
