import { test } from './helpers/context.js'

import pDefer from 'p-defer'

import { reportPieceCid } from '../index.js'
import { getServiceSigner } from '../service.js'

import { getAggregatorServiceServer, getAggregatorServiceCtx } from './helpers/ucanto.js'
import { createCar } from './helpers/car.js'

test('reports piece cid from a piece written to the piece table', async t => {
  const { piece } = await createCar()
  const aggregatorQueueCall = pDefer()
  const { invocationConfig, aggregatorService } = await getService({
    onCall: aggregatorQueueCall
  })

  const reportPieceCidResponse = await reportPieceCid({
    piece,
    group: invocationConfig.issuer.did(),
    invocationConfig,
    aggregateServiceConnection: aggregatorService.connection
  })

  t.truthy(reportPieceCidResponse.ok)
  t.falsy(reportPieceCidResponse.error)

  // Validate ucanto server call
  t.is(aggregatorService.service.aggregate.queue.callCount, 1)
  const invCap = await aggregatorQueueCall.promise
  t.is(invCap.can, 'aggregate/queue')
})

test('fails reporting piece cid if fails to queue to aggregator', async t => {
  const { piece } = await createCar()
  const aggregatorQueueCall = pDefer()
  const { invocationConfig, aggregatorService } = await getService({
    onCall: aggregatorQueueCall,
    mustFail: true
  })

  const reportPieceCidResponse = await reportPieceCid({
    piece,
    group: invocationConfig.issuer.did(),
    invocationConfig,
    aggregateServiceConnection: aggregatorService.connection
  })

  t.falsy(reportPieceCidResponse.ok)
  t.truthy(reportPieceCidResponse.error)

  t.is(aggregatorService.service.aggregate.queue.callCount, 1)
})

/**
 * @param {object} options
 * @param {import('p-defer').DeferredPromise<any>} options.onCall
 * @param {boolean} [options.mustFail]
 */
async function getService (options) {
  const { storefront, aggregator } = await getAggregatorServiceCtx()
  const aggregatorService = await getAggregatorServiceServer(aggregator.raw, {
    onCall: (invCap) => {
      options.onCall.resolve(invCap)
    },
    mustFail: options.mustFail
  })
  const issuer = getServiceSigner(storefront)
  const audience = aggregatorService.connection.id
  /** @type {import('@web3-storage/filecoin-client/types').InvocationConfig} */
  const invocationConfig = {
    issuer,
    audience,
    with: issuer.did(),
  }

  return {
    invocationConfig,
    aggregatorService
  }
}
