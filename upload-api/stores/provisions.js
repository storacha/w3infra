import { cidrSplitToCfnExpression } from 'aws-cdk-lib/aws-ec2'
import { ConflictError as ConsumerConflictError } from '../tables/consumer.js'
import { ConflictError as SubscriptionConflictError } from '../tables/subscription.js'
import { CBOR, Failure } from '@ucanto/server'
import { productInfo } from '../../billing/lib/product-info.js'


/**
 * @param {string | number | Date} now 
 */
const startOfMonth = (now) => {
  const d = new Date(now)
  d.setUTCDate(1)
  d.setUTCHours(0)
  d.setUTCMinutes(0)
  d.setUTCSeconds(0)
  d.setUTCMilliseconds(0)
  return d
}

/**
 * @param {string | number | Date} now 
 */
const startOfLastMonth = (now) => {
  const d = startOfMonth(now)
  d.setUTCMonth(d.getUTCMonth() - 1)
  return d
}

/**
 * Create a subscription ID for a given provision. Currently 
 * uses a CID generated from `consumer` which ensures a space
 * can be provisioned at most once.
 * 
 * @param {import('@storacha/upload-api').Provision} item 
 * @returns string
 */
export const createProvisionSubscriptionId = async ({ customer, consumer }) =>
  (await CBOR.write({ consumer })).cid.toString()

/**
 * @param {import('../types.js').SubscriptionTable} subscriptionTable
 * @param {import('../types.js').ConsumerTable} consumerTable
 * @param {import("../../billing/lib/api.js").CustomerStore} customerStore
 * @param {import('@storacha/upload-api').UsageStorage} usageStore
 * @param {import('@ucanto/interface').DID<'web'>[]} services
 * @returns {import('@storacha/upload-api').ProvisionsStorage}
 */
export function useProvisionStore (subscriptionTable, consumerTable, customerStore, usageStore, services) {
  return {
    services,
    hasStorageProvider: async (consumer) => (
      { ok: await consumerTable.hasStorageProvider(consumer) }
    ),

    getStorageProviders: async (consumer) => (
      { ok: await consumerTable.getStorageProviders(consumer) }
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
          customer,
          subscription
        })
        return { ok: { id: subscription } }
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
      const consumerRecord = await consumerTable.get(provider, consumer)
      if (!consumerRecord) {
        return { error: { name: 'ConsumerNotFound', message: `could not find ${consumer}` } }
      }
      const planLimitResult = await customerStore.planLimit(consumerRecord.customer)
      if (planLimitResult.error) {
        return { error: planLimitResult.error }
      }
      const consumerRecords = await consumerTable.listByCustomer(consumerRecord.customer)
      let totalUsage = 0
      for (const consumer of consumerRecords.results) {
        const now = new Date()
        const spaceUsage = await usageStore.report(consumer.provider, consumer.consumer, {
          // we may not have done a snapshot for this month _yet_, so get report
          // from last month -> now
          from: startOfLastMonth(now),
          to: now,
        })

        if (spaceUsage.error) {
          return { error: { name: 'UsageReportError', message: `could not get usage report for ${consumer.consumer}`, cause: spaceUsage.error } }
        }
        totalUsage += spaceUsage.ok.size.final
      }

      return ({
        ok: {
          did: consumer,
          allocated: totalUsage, // set to 0 because we currently don't track allocated space
          limit: planLimitResult.ok,
          subscription: consumerRecord.subscription,
          customer: consumerRecord.customer
        }
      })
    },

    getSubscription: async (provider, subscription) => {
      const [subscriptionRecord, consumerRecord] = await Promise.all([
        subscriptionTable.get(provider, subscription),
        consumerTable.getBySubscription(provider, subscription)
      ])
      if (subscriptionRecord) {
        /** @type {import('@storacha/upload-api').Subscription} */
        const result = {
          customer: /** @type {import('@storacha/upload-api').AccountDID} */(subscriptionRecord.customer)
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
