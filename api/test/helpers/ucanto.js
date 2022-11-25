import * as UcantoClient from '@ucanto/client'
import { CAR, CBOR } from '@ucanto/transport'
import * as Signer from '@ucanto/principal/ed25519'

import { createUcantoServer } from '../../service/index.js'
import { createCarStore } from '../../buckets/car-store.js'
import { createDudewhereStore } from '../../buckets/dudewhere-store.js'
import { createStoreTable } from '../../tables/store.js'
import { createUploadTable } from '../../tables/upload.js'
import { createSigner } from '../../signer.js'

import { createAccessClient } from '../../access.js'

/**
 * @typedef {object} ResourcesMetadata
 * @property {string} [region]
 * @property {string} tableName
 * @property {string} bucketName
 */

/**
 * @param {import('@ucanto/interface').Signer} service
 * @param {import('./context.js').UcantoServerContext & ResourcesMetadata} ctx
 */
export function createTestingUcantoServer(service, ctx) {
  const region = ctx.region || 'us-west-2'
 return createUcantoServer(service, {
   storeTable: createStoreTable(region, ctx.tableName, {
     endpoint: ctx.dbEndpoint
   }),
   uploadTable: createUploadTable(region, ctx.tableName, {
     endpoint: ctx.dbEndpoint
   }),
   carStoreBucket: createCarStore(region, ctx.bucketName, { ...ctx.s3ClientOpts }),
   dudewhereBucket: createDudewhereStore(region, ctx.bucketName, { ...ctx.s3ClientOpts }),
   signer: createSigner(getSigningOptions(ctx)),
   access: createAccessClient(service, ctx.access.servicePrincipal, ctx.access.serviceURL)
 })
}

/**
 * @param {import('@ucanto/interface').Signer} service
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

/**
 * @param {any} ctx 
 */
 export function getSigningOptions(ctx) {
  return {
    region: ctx.region || 'us-west-2',
    secretAccessKey: ctx.secretAccessKey,
    accessKeyId: ctx.accessKeyId,
    sessionToken: ctx.sessionToken,
    bucket: ctx.bucketName,
  }
}