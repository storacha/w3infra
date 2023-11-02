import { test } from './helpers/context.js'

import pDefer from 'p-defer'

import { reportPieceCid } from '../index.js'
import { getServiceSigner } from '../service.js'

import { getClaimsServiceServer, getServiceCtx } from './helpers/ucanto.js'
import { createCar } from './helpers/car.js'

test('reports piece cid from a piece written to the piece table', async t => {
  const { piece, link } = await createCar()
  const claimsEqualsCall = pDefer()
  const { claimsInvocationConfig, claimsService } = await getService({
    claims: {
      onCall: claimsEqualsCall
    }
  })

  const reportPieceCidResponse = await reportPieceCid({
    piece,
    content: link,
    claimsInvocationConfig,
    claimsServiceConnection: claimsService.connection,
  })

  t.truthy(reportPieceCidResponse.ok)
  t.falsy(reportPieceCidResponse.error)

  // Validate ucanto server calls
  t.is(claimsService.service.assert.equals.callCount, 1)
  const invCapClaims = await claimsEqualsCall.promise
  t.is(invCapClaims.can, 'assert/equals')
})

test('fails reporting piece cid if fails to claim equals', async t => {
  const { piece, link } = await createCar()
  const claimEqualsCall = pDefer()
  const { claimsInvocationConfig, claimsService } = await getService({
    claims: {
      onCall: claimEqualsCall,
      mustFail: true
    }
  })

  const reportPieceCidResponse = await reportPieceCid({
    piece,
    content: link,
    claimsInvocationConfig,
    claimsServiceConnection: claimsService.connection,
  })

  t.falsy(reportPieceCidResponse.ok)
  t.truthy(reportPieceCidResponse.error)

  // Validate ucanto server calls
  t.is(claimsService.service.assert.equals.callCount, 1)
})

/**
 * @typedef {object} Props
 * @property {import('p-defer').DeferredPromise<any>} onCall
 * @property {boolean} [mustFail]
 * 
 * @param {Record<'claims', Props>} options
 */
async function getService (options) {
  const { storefront, claims } = await getServiceCtx()
  const claimsService = await getClaimsServiceServer(claims.raw, {
    onCall: (invCap) => {
      options.claims.onCall.resolve(invCap)
    },
    mustFail: options.claims.mustFail
  })

  const issuer = getServiceSigner(storefront)

  return {
    claimsInvocationConfig:/** @type {import('../types').ClaimsInvocationConfig} */({
      issuer,
      audience: claimsService.connection.id,
      with: issuer.did(),
    }),
    claimsService,
  }
}
