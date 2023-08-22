import { ConflictError as ConsumerConflictError } from '../tables/consumer.js'
import { ConflictError as SubscriptionConflictError } from '../tables/subscription.js'
import { CBOR, Failure } from '@ucanto/server'

/**
 * Create a subscription ID for a given provision. Currently 
 * uses the CID of `customer` which ensures each customer
 * will get at most one subscription. This can be relaxed (ie,
 * by deriving subscription ID from customer AND consumer) in the future
 * or by other providers for flexibility.
 * 
 * @param {import('@web3-storage/upload-api').Provision} item 
 * @returns string
 */
export const createProvisionSubscriptionId = async ({ customer }) =>
  (await CBOR.write({ customer })).cid.toString()

/**
 * @param {import('../types').SubscriptionTable} subscriptionTable
 * @param {import('../types').ConsumerTable} consumerTable
 * @param {import('../types').SpaceMetricsTable} spaceMetricsTable
 * @param {import('@ucanto/interface').DID<'web'>[]} services
 * @returns {import('@web3-storage/upload-api').ProvisionsStorage}
 */
export function useProvisionStore (subscriptionTable, consumerTable, spaceMetricsTable, services) {
  return {
    services,
    hasStorageProvider: async (consumer) => (
      { ok: await consumerTable.hasStorageProvider(consumer) }
    ),

    put: async (item) => {
      const { cause, consumer, customer, provider } = item
      const subscription = await createProvisionSubscriptionId(item)

      try {
        await subscriptionTable.add({
          cause: cause.cid,
          provider,
          customer,
          subscription
        })
      } catch (error) {
        // if we got a conflict error, ignore - it means the subscription already exists and
        // can be used to create a consumer/provider relationship below
        if (!(error instanceof SubscriptionConflictError)) {
          return {
            error: new Failure('Unknown error adding subscription', {
              cause: error
            })
          }
        }
      }

      try {
        await consumerTable.add({
          cause: cause.cid,
          provider,
          consumer,
          subscription
        })
        return { ok: {} }
      } catch (error) {
        return (error instanceof ConsumerConflictError) ? (
          {
            error
          }
        ) : (
          {
            error: new Failure('Unknown error adding consumer', {
              cause: error
            })
          }
        )
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
        return { error: { name: 'CustomerNotFound', message: `could not find ${customer}` } }
      }
      return {
        ok: {
          did: customer,
          subscriptions: subscriptions.map(s => s.subscription)
        }
      }
    },

    getConsumer: async (provider, consumer) => {
      const [consumerRecord, allocated] = await Promise.all([
        consumerTable.get(provider, consumer),
        spaceMetricsTable.getAllocated(consumer)
      ])
      return consumerRecord ? ({
        ok: {
          did: consumer,
          allocated,
          limit: 1_000_000_000, // set to an arbitrarily high number because we currently don't enforce any limits
          subscription: consumerRecord.subscription
        }
      }) : (
        { error: { name: 'ConsumerNotFound', message: `could not find ${consumer}` } }
      )
    },

    getSubscription: async (provider, subscription) => {
      const [subscriptionRecord, consumerRecord] = await Promise.all([
        subscriptionTable.get(provider, subscription),
        consumerTable.getBySubscription(provider, subscription)
      ])
      if (subscriptionRecord) {
        /** @type {import('@web3-storage/upload-api/dist/src/types/provisions').Subscription} */
        const result = {
          customer: /** @type {import('@web3-storage/upload-api').AccountDID} */(subscriptionRecord.customer)
        }
        if (consumerRecord) {
          result.consumer = /** @type {import('@ucanto/interface').DIDKey} */(consumerRecord.consumer)
        }
        return { ok: result }

      } else {
        return { error: { name: 'SubscriptionNotFound', message: 'unimplemented' } }
      }
    }
  }
}
