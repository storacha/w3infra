import { iterateSpaceDiffs } from '@web3-storage/w3infra-billing/lib/space-billing-queue.js'

/**
 * @param {object} conf
 * @param {import('@web3-storage/w3infra-billing/lib/api').SpaceSnapshotStore} conf.spaceSnapshotStore
 * @param {import('@web3-storage/w3infra-billing/lib/api').SpaceDiffStore} conf.spaceDiffStore
 * @param {import('@web3-storage/w3infra-billing/lib/api').EgressTrafficQueue} conf.egressTrafficQueue
 */
export function useUsageStore({ spaceSnapshotStore, spaceDiffStore, egressTrafficQueue }) {
  return {
    /**
     * @param {import('@web3-storage/upload-api').ProviderDID} provider
     * @param {import('@web3-storage/upload-api').SpaceDID} space
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

      /** @type {import('@web3-storage/upload-api').UsageData} */
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
     * Handle egress traffic data and enqueues it, so the billing system can process it and update the Stripe Billing Meter API.
     * 
     * @param {import('@web3-storage/upload-api').AccountDID} customer
     * @param {import('@web3-storage/upload-api').UnknownLink} resource
     * @param {bigint} bytes
     * @param {Date} servedAt
     * @returns {Promise<import('@ucanto/interface').Result<import('@ucanto/interface').Unit, import('@ucanto/interface').Failure>>}
     */
    async record(customer, resource, bytes, servedAt) {
      const record = {
        customer,
        resource,
        bytes,
        servedAt
      }

      const result = await egressTrafficQueue.add(record)
      if (result.error) return result

      return { ok: record }
    }
  }
}
