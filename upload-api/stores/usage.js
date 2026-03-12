import { trace } from '@opentelemetry/api'
import { iterateSpaceDiffs, findSnapshotAtOrBefore } from '../../billing/lib/space-size.js'
import { instrumentMethods } from '../lib/otel/instrument.js'
import { startOfToday } from '../../billing/lib/util.js'

const tracer = trace.getTracer('upload-api')

/**
 * @param {object} conf
 * @param {import('../../billing/lib/api.js').SpaceSnapshotStore} conf.spaceSnapshotStore
 * @param {import('../../billing/lib/api.js').SpaceDiffStore} conf.spaceDiffStore
 * @param {import('../../billing/lib/api.js').EgressTrafficEventStore} conf.egressTrafficStore
 * @param {import('../../billing/lib/api.js').EgressTrafficQueue} conf.egressTrafficQueue
 * @param {import('../../billing/lib/api.js').EgressTrafficMonthlyStore} [conf.egressTrafficMonthlyStore] - Optional monthly store for fast aggregation
 * @returns {import('@storacha/upload-api').UsageStorage}
 */
export function useUsageStore({ spaceSnapshotStore, spaceDiffStore, egressTrafficStore, egressTrafficQueue, egressTrafficMonthlyStore }) {
  return instrumentMethods(tracer, 'UsageStorage', {
    /**
     * @param {import('@storacha/upload-api').ProviderDID} provider
     * @param {import('@storacha/upload-api').SpaceDID} space
     * @param {{ from: Date, to: Date }} period
     */
    async report(provider, space, period) {
      const targetDate = startOfToday(period.to)
      const snapshotResult = await findSnapshotAtOrBefore(
        { space, provider, targetDate },
        { spaceSnapshotStore }
      )
      if (snapshotResult.error) return { error: snapshotResult.error }
      const latestSnapshotValue = snapshotResult.ok ? snapshotResult.ok.size : 0n
      const latestSnapshotDate = snapshotResult.ok ? snapshotResult.ok.recordedAt : period.from

      let final = latestSnapshotValue
      const events = []
      const query = { provider, space, from: latestSnapshotDate, to: period.to }
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
          initial: Number(latestSnapshotValue),
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
      // Pass egress monthly aggregation store to enable fast report
      const result = await egressTrafficStore.sumBySpace(space, period, egressTrafficMonthlyStore)
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
