import * as UcantoClient from '@ucanto/client'
import { CAR, CBOR } from '@ucanto/transport'
import * as Signer from '@ucanto/principal/ed25519'

import { createUcantoServer } from '../../functions/ucan-invocation-router.js'
import { createCarStore } from '../../buckets/car-store.js'
import { createStoreTable } from '../../tables/store.js'
import { createUploadTable } from '../../tables/upload.js'
import { createSigner } from '../../signer.js'

import { getSigningOptions } from '../utils.js'

/**
 * @param {any} ctx
 */
export function createTestingUcantoServer(ctx) {
 return createUcantoServer({
   storeTable: createStoreTable(ctx.region, ctx.tableName, {
     endpoint: ctx.dbEndpoint
   }),
   uploadTable: createUploadTable(ctx.region, ctx.tableName, {
     endpoint: ctx.dbEndpoint
   }),
   carStoreBucket: createCarStore(ctx.region, ctx.bucketName, { ...ctx.s3ClientOpts }),
   signer: createSigner(getSigningOptions(ctx))
 })
}

/**
 * @param {import('@ucanto/principal/ed25519').EdSigner} service 
 * @param {any} context 
 * @returns 
 */
export async function getClientConnection (service, context) {
  return UcantoClient.connect({
    id: service,
    encoder: CAR,
    decoder: CBOR,
    channel: await createTestingUcantoServer(context),
  })
}

/**
 * @param {import("@ucanto/principal/dist/src/ed25519/type.js").EdSigner<"key">} audience
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
