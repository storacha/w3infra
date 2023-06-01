import { ConflictError as ConsumerConflictError } from '../tables/consumer.js'
import { ConflictError as SubscriptionConflictError } from '../tables/subscription.js'

/**
 * @param {import('../types').SubscriptionTable} subscriptionTable
 * @param {import('../types').ConsumerTable} consumerTable
 * @param {import('@ucanto/interface').DID<'web'>[]} services
 * @returns {import('@web3-storage/upload-api').ProvisionsStorage}
 */
export function useProvisionStore (subscriptionTable, consumerTable, services) {
  return {
    services,
    hasStorageProvider: async (consumer) => (
      { ok: await consumerTable.hasStorageProvider(consumer) }
    ),

    put: async (item) => {
      const { cause, consumer, customer, provider } = item
      // by setting subscription to customer we make it so each customer can have at most one subscription
      // TODO is this what we want?
      const subscription = customer

      try {
        await subscriptionTable.insert({
          cause: cause.cid,
          provider,
          customer,
          subscription
        })
      } catch (error) {
        // if we got a conflict error, ignore - it means the subscription already exists and
        // can be used to create a consumer/provider relationship below
        if (!(error instanceof SubscriptionConflictError)) {
          throw error
        }
      }

      try {
        await consumerTable.insert({
          cause: cause.cid,
          provider,
          consumer,
          subscription
        })
        return { ok: {} }
      } catch (error) {
        if (error instanceof ConsumerConflictError) {
          return {
            error
          }
        } else {
          throw error
        }
      }
    },

    /**
     * get number of stored items
     */
    count: async () => {
      return consumerTable.count()
    },

    getCustomer: async (provider, customer) => {
      const subscriptions = await subscriptionTable.findProviderSubscriptionsForCustomer(customer, provider)
      // if we don't have any subscriptions for a customer
      if (subscriptions.length === 0) {
        return { ok: null }
      }
      return {
        ok: {
          did: customer
        }
      }
    }
  }
}
