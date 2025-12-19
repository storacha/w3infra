import { trace } from '@opentelemetry/api'
import { iterateSpaceDiffs } from '../../billing/lib/space-billing-queue.js'
import { instrumentMethods } from '../lib/otel/instrument.js'

const tracer = trace.getTracer('upload-api')

/**
 * @param {object} conf
 * @param {import('../../billing/lib/api.js').SpaceSnapshotStore} conf.spaceSnapshotStore
 * @param {import('../../billing/lib/api.js').SpaceDiffStore} conf.spaceDiffStore
 * @param {import('../../billing/lib/api.js').EgressTrafficEventStore} conf.egressTrafficStore
 * @param {import('../../billing/lib/api.js').EgressTrafficQueue} conf.egressTrafficQueue
 * @returns {import('@storacha/upload-api').UsageStorage}
 */
export function useUsageStore({ spaceSnapshotStore, spaceDiffStore, egressTrafficStore, egressTrafficQueue }) {
  return instrumentMethods(tracer, 'UsageStorage', {
    /**
     * @param {import('@storacha/upload-api').ProviderDID} provider
     * @param {import('@storacha/upload-api').SpaceDID} space
     * @param {{ from: Date, to: Date }} period
     */
    async report(provider, space, period) {
      const snapResult = await spaceSnapshotStore.get({
        provider,
        space,
        recordedAt: period.from
      })
      const initial = snapResult.error ? 0n : snapResult.ok.size
      if (snapResult.error && snapResult.error.name !== 'RecordNotFound') {
        return snapResult
      }

      let final = initial
      const events = []
      const query = { provider, space, ...period }
      for await (const page of iterateSpaceDiffs(query, { spaceDiffStore })) {
        if (page.error) return page
        for (const diff of page.ok) {
          events.push({
            cause: diff.cause,
            delta: diff.delta,
            receiptAt: diff.receiptAt.toISOString()
          })
          final += BigInt(diff.delta)
        }
      }

      if (final > Number.MAX_SAFE_INTEGER) {
        return { error: new Error('space is bigger than MAX_SAFE_INTEGER') }
      }

      /** @type {import('@storacha/upload-api').UsageData} */
      const report = {
        provider,
        space,
        period: {
          from: period.from.toISOString(),
          to: period.to.toISOString()
        },
        size: {
          initial: Number(initial),
          final: Number(final)
        },
        events,
      }
      return { ok: report }
    },

    /**
     * @param {import('@storacha/upload-api').ProviderDID} provider
     * @param {import('@storacha/upload-api').SpaceDID} space
     * @param {{ from: Date, to: Date }} period
     */
    async reportEgress(provider, space, period) {
      const result = await egressTrafficStore.sumBySpace(space, period)
      if (result.error) {
        return result
      }

      /** @type {import('@storacha/upload-api').EgressUsageData} */
      const egressReport = {
        provider,
        space,
        period: {
          from: period.from.toISOString(),
          to: period.to.toISOString()
        },
        total: result.ok
      }

      return { ok: egressReport }
    },

    /**
     * Handle egress traffic data and enqueues it, so the billing system can process it and update the Stripe Billing Meter API.
     *
     * @param {import('@storacha/upload-api').SpaceDID} space - The space that the egress traffic is associated with.
     * @param {import('@storacha/upload-api').AccountDID} customer - The customer that will be billed for the egress traffic.
     * @param {import('@storacha/upload-api').UnknownLink} resource - The resource that was served.
     * @param {number} bytes - The number of bytes that were served.
     * @param {Date} servedAt - The date and time when the egress traffic was served.
     * @param {import('@storacha/upload-api').UnknownLink} cause - The UCAN invocation ID that caused the egress traffic.
     * @returns {Promise<import('@ucanto/interface').Result<import('@storacha/upload-api').EgressData, import('@ucanto/interface').Failure>>}
     */
    async record(space, customer, resource, bytes, servedAt, cause) {
      const record = {
        space,
        customer,
        resource,
        bytes,
        servedAt,
        cause
      }

      const result = await egressTrafficQueue.add(record)
      if (result.error) {
        console.error('Error sending egress event to queue:', result.error)
        return result
      }

      return { ok: { ...record, servedAt: servedAt.toISOString() } }
    }
  })
}
