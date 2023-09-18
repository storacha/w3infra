import { test } from './helpers/context.js'

import pDefer from 'p-defer'

import { reportPieceCid } from '../index.js'
import { getServiceSigner } from '../service.js'

import { getAggregatorServiceServer, getClaimsServiceServer, getServiceCtx } from './helpers/ucanto.js'
import { createCar } from './helpers/car.js'

test('reports piece cid from a piece written to the piece table', async t => {
  const { piece, link } = await createCar()
  const aggregatorQueueCall = pDefer()
  const claimsEqualsCall = pDefer()
  const { aggregateInvocationConfig, aggregatorService, claimsInvocationConfig, claimsService } = await getService({
    aggregator: {
      onCall: aggregatorQueueCall
    },
    claims: {
      onCall: claimsEqualsCall
    }
  })

  const reportPieceCidResponse = await reportPieceCid({
    piece,
    content: link,
    group: aggregateInvocationConfig.issuer.did(),
    aggregateInvocationConfig,
    aggregateServiceConnection: aggregatorService.connection,
    claimsInvocationConfig,
    claimsServiceConnection: claimsService.connection,
  })

  t.truthy(reportPieceCidResponse.ok)
  t.falsy(reportPieceCidResponse.error)

  // Validate ucanto server calls
  t.is(claimsService.service.assert.equals.callCount, 1)
  const invCapClaims = await claimsEqualsCall.promise
  t.is(invCapClaims.can, 'assert/equals')

  t.is(aggregatorService.service.aggregate.queue.callCount, 1)
  const invCapAggregator = await aggregatorQueueCall.promise
  t.is(invCapAggregator.can, 'aggregate/queue')
})

test('fails reporting piece cid if fails to claim equals', async t => {
  const { piece, link } = await createCar()
  const aggregatorQueueCall = pDefer()
  const claimEqualsCall = pDefer()
  const { aggregateInvocationConfig, aggregatorService, claimsInvocationConfig, claimsService } = await getService({
    aggregator: {
      onCall: aggregatorQueueCall
    },
    claims: {
      onCall: claimEqualsCall,
      mustFail: true
    }
  })

  const reportPieceCidResponse = await reportPieceCid({
    piece,
    content: link,
    group: aggregateInvocationConfig.issuer.did(),
    aggregateInvocationConfig,
    aggregateServiceConnection: aggregatorService.connection,
    claimsInvocationConfig,
    claimsServiceConnection: claimsService.connection,
  })

  t.falsy(reportPieceCidResponse.ok)
  t.truthy(reportPieceCidResponse.error)

  // Validate ucanto server calls
  t.is(claimsService.service.assert.equals.callCount, 1)
  t.is(aggregatorService.service.aggregate.queue.callCount, 0)
})

test('fails reporting piece cid if fails to queue to aggregator', async t => {
  const { piece, link } = await createCar()
  const aggregatorQueueCall = pDefer()
  const claimEqualsCall = pDefer()
  const { aggregateInvocationConfig, aggregatorService, claimsInvocationConfig, claimsService } = await getService({
    aggregator: {
      onCall: aggregatorQueueCall,
      mustFail: true
    },
    claims: {
      onCall: claimEqualsCall
    }
  })

  const reportPieceCidResponse = await reportPieceCid({
    piece,
    content: link,
    group: aggregateInvocationConfig.issuer.did(),
    aggregateInvocationConfig,
    aggregateServiceConnection: aggregatorService.connection,
    claimsInvocationConfig,
    claimsServiceConnection: claimsService.connection,
  })

  t.falsy(reportPieceCidResponse.ok)
  t.truthy(reportPieceCidResponse.error)

  // Validate ucanto server calls
  t.is(claimsService.service.assert.equals.callCount, 1)
  t.is(aggregatorService.service.aggregate.queue.callCount, 1)
})

/**
 * @typedef {object} Props
 * @property {import('p-defer').DeferredPromise<any>} onCall
 * @property {boolean} [mustFail]
 * 
 * @param {Record<'aggregator' | 'claims', Props>} options
 */
async function getService (options) {
  const { storefront, aggregator, claims } = await getServiceCtx()
  const aggregatorService = await getAggregatorServiceServer(aggregator.raw, {
    onCall: (invCap) => {
      options.aggregator.onCall.resolve(invCap)
    },
    mustFail: options.aggregator.mustFail
  })

  const claimsService = await getClaimsServiceServer(claims.raw, {
    onCall: (invCap) => {
      options.claims.onCall.resolve(invCap)
    },
    mustFail: options.claims.mustFail
  })

  const issuer = getServiceSigner(storefront)

  return {
    aggregateInvocationConfig: /** @type {import('@web3-storage/filecoin-client/types').InvocationConfig} */({
      issuer,
      audience: aggregatorService.connection.id,
      with: issuer.did(),
    }),
    aggregatorService,
    claimsInvocationConfig:/** @type {import('../types').ClaimsInvocationConfig} */({
      issuer,
      audience: claimsService.connection.id,
      with: issuer.did(),
    }),
    claimsService,
  }
}
