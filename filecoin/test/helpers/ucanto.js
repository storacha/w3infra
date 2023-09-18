import * as Signer from '@ucanto/principal/ed25519'
import * as Server from '@ucanto/server'
import * as Client from '@ucanto/client'
import * as CAR from '@ucanto/transport/car'
import * as FilecoinCapabilities from '@web3-storage/capabilities/filecoin'
import { Assert } from '@web3-storage/content-claims/capability'

import { OperationFailed } from './errors.js'
import { mockService } from './mocks.js'

const nop = (/** @type {any} */ invCap) => {}

/**
 * @param {any} serviceProvider
 * @param {object} [options]
 * @param {(inCap: any) => void} [options.onCall]
 * @param {boolean} [options.mustFail]
 */
export async function getClaimsServiceServer (serviceProvider, options = {}) {
  const onCall = options.onCall || nop
  const equalsStore = new Map()

  const service = mockService({
    assert: {
      equals: Server.provide(Assert.equals, async ({ capability, invocation }) => {
        const invCap = invocation.capabilities[0]
        const { content, equals } = capability.nb

        if (options.mustFail) {
          return {
            error: new OperationFailed(
              'failed to add to aggregate',
              // @ts-ignore wrong dep
              invCap.nb?.content
            )
          }
        }

        equalsStore.set(content.toString(), equals.toString())
        equalsStore.set(equals.toString(), content.toString())

        onCall(invCap)

        return {
          ok: {}
        }
      })
    }
  })

  const server = Server.create({
    id: serviceProvider,
    service,
    codec: CAR.inbound,
  })
  const connection = Client.connect({
    id: serviceProvider,
    codec: CAR.outbound,
    channel: server,
  })

  return {
    service,
    connection
  }
}

/**
 * @param {any} serviceProvider
 * @param {object} [options]
 * @param {(inCap: any) => void} [options.onCall]
 * @param {boolean} [options.mustFail]
 */
export async function getAggregatorServiceServer (serviceProvider, options = {}) {
  const onCall = options.onCall || nop

  const service = mockService({
    aggregate: {
      queue: Server.provideAdvanced({
        capability: FilecoinCapabilities.aggregateQueue,
        handler: async ({ invocation, context }) => {
          const invCap = invocation.capabilities[0]

          if (!invCap.nb) {
            throw new Error('no nb field received in invocation')
          }

          if (options.mustFail) {
            return {
              error: new OperationFailed(
                'failed to add to aggregate',
                // @ts-ignore wrong dep
                invCap.nb.aggregate
              )
            }
          }

          /** @type {import('@web3-storage/capabilities/types').AggregateAddSuccess} */
          const pieceAddResponse = {
            piece: invCap.nb.piece,
          }

          // Create effect for receipt with self signed queued operation
          const fx = await FilecoinCapabilities.aggregateAdd
          .invoke({
            issuer: context.id,
            audience: context.id,
            with: context.id.did(),
            nb: {
              ...invCap.nb,
              // add storefront
              storefront: invCap.with,
            },
          })
          .delegate()

          onCall(invCap)

          return Server.ok(pieceAddResponse).join(fx.link())
        }
      }),
      add: Server.provideAdvanced({
        capability: FilecoinCapabilities.aggregateAdd,
        handler: async ({ invocation }) => {
          const invCap = invocation.capabilities[0]

          if (!invCap.nb) {
            throw new Error('no nb field received in invocation')
          }

          if (options.mustFail) {
            return {
              error: new OperationFailed(
                'failed to add to aggregate',
                // @ts-ignore wrong dep
                invCap.nb.aggregate
              )
            }
          }

          /** @type {import('@web3-storage/capabilities/types').AggregateAddSuccess} */
          const pieceAddResponse = {
            piece: invCap.nb.piece,
          }

          onCall(invCap)

          return Server.ok(pieceAddResponse)
        }
      })
    }
  })

  const server = Server.create({
    id: serviceProvider,
    service,
    codec: CAR.inbound,
  })
  const connection = Client.connect({
    id: serviceProvider,
    codec: CAR.outbound,
    channel: server,
  })

  return {
    service,
    connection
  }
}

export async function getServiceCtx () {
  const storefront = await Signer.generate()
  const aggregator = await Signer.generate()
  const claims = await Signer.generate()
  
  return {
    storefront: {
      did: storefront.did(),
      privateKey: Signer.format(storefront),
      raw: storefront
    },
    aggregator: {
      did: aggregator.did(),
      privateKey: Signer.format(aggregator),
      raw: aggregator
    },
    claims: {
      did: claims.did(),
      privateKey: Signer.format(claims),
      raw: claims
    }
  }
}
