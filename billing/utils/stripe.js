import * as DidMailto from '@storacha/did-mailto'
import { Failure } from '@ucanto/core'
import { RecordNotFound } from '../tables/lib.js'
import { createHash } from 'crypto'
import retry from 'p-retry'

export class CustomerFoundWithDifferentStripeAccount extends Failure {
  /**
   * @param {string} customer
   * @param {string} expectedAccount
   * @param {string} foundAccount
   */
  constructor(customer, expectedAccount, foundAccount) {
    super()
    this.customer = customer
    this.expectedAccount = expectedAccount
    this.foundAccount = foundAccount
  }

  describe() {
    return `expected ${this.customer} to have account ${this.expectedAccount} but got ${this.foundAccount}`
  }

  toJSON() {
    return {
      ...super.toJSON(),
      customer: this.customer,
      expectedAccount: this.expectedAccount,
      foundAccount: this.foundAccount
    }
  }
}

/**
 * @typedef {import('../lib/api.js').AccountID} AccountID
 * @typedef {import('stripe').Stripe} Stripe
 * @typedef {import('stripe').Stripe.CustomerSubscriptionCreatedEvent} CustomerSubscriptionCreatedEvent
 */

/**
 * Converts a Stripe customer ID to an Account ID.
 * e.g:
 *   cus_1234567890 -> stripe:cus_1234567890
 * 
 * @param {string} stripeID 
 * @returns {AccountID}
 */
export function stripeIDToAccountID(stripeID) {
  return /** @type {AccountID} */(`stripe:${stripeID}`)
}

/**
 * Converts an Account ID to a Stripe customer ID.
 * e.g:
 *   stripe:cus_1234567890 -> cus_1234567890
 * 
 * @param {AccountID} accountID 
 * @returns {string}
 */
export const accountIDToStripeCustomerID = (accountID) => accountID.slice('stripe:'.length)


/**
 *
 * @param {Stripe} stripe
 * @param {CustomerSubscriptionCreatedEvent} event
 * @param {import('../lib/api.js').CustomerStore} customerStore
 * @param {Record<string, string>} pricesToPlansMapping
 * @returns {Promise<import('@ucanto/interface').Result<import('@ucanto/interface').Unit, import('@ucanto/interface').Failure>>}
 */
export async function handleCustomerSubscriptionCreated(stripe, event, customerStore, pricesToPlansMapping) {
  // per https://stripe.com/docs/expand#with-webhooks these attributes will always be a string in a webhook, so these typecasts are safe
  const customerId = String(event.data.object.customer)
  const product = pricesToPlansMapping[event.data.object.items.data[0].price.id] || String(event.data.object.items.data[0].price.lookup_key)
  if (!product.startsWith('did:web:')) {
    return { error: new Error(`Invalid product: ${product}`) }
  }

  const account = stripeIDToAccountID(customerId)
  const stripeCustomer = await stripe.customers.retrieve(customerId)
  if (stripeCustomer.deleted) {
    return {
      error: new Error(`Could not update subscription information - user appears to have been deleted`)
    }
  } else {
    // First, try to locate by Stripe account to avoid email changes creating duplicates.
  const byAccount = await /** @type {any} */ (customerStore).getByAccount(account)
    if (byAccount.ok) {
      const customerRecord = byAccount.ok
      // Update only the product to avoid overwriting attributes omitted by GSI projection (like insertedAt)
      return /** @type {any} */ (customerStore).updateProduct(customerRecord.customer, product)
    } else if (byAccount.error instanceof RecordNotFound) {
      // No record by account — fall back to DID derived from Stripe email.
      const customer = DidMailto.fromEmail(/** @type {`${string}@${string}`} */(
        stripeCustomer.email
      ))

      const customerResult = await customerStore.get({ customer })
      if (customerResult.ok) {
        const customerRecord = customerResult.ok
        if (customerRecord.account && (customerRecord.account !== account)) {
          return {
            error: new CustomerFoundWithDifferentStripeAccount(customer, customerRecord.account, account)
          }
        }

        return customerStore.put({
          ...customerRecord,
          account,
          product,
          updatedAt: new Date()
        })
      } else if (customerResult.error instanceof RecordNotFound) {
        return customerStore.put({
          customer,
          account,
          product,
          insertedAt: new Date(),
          updatedAt: new Date()
        })
      } else {
        // it's an error result but we don't know how to handle it - propagate it!
        return customerResult
      }
    } else {
      // Unexpected error when listing by account — propagate it.
      return byAccount
    }
  }
}

/**
 * Records an egress traffic event in the Stripe Billing Meter API for the given customer account.
 * 
 * @param {import('stripe').Stripe} stripe
 * @param {string} billingMeterEventName
 * @param {import('../lib/api.js').EgressTrafficData} egressData
 * @param {AccountID} customerAccount
 */
export async function recordBillingMeterEvent(stripe, billingMeterEventName, egressData, customerAccount) {
  const stripeCustomerId = accountIDToStripeCustomerID(customerAccount)
  /** @type {import('stripe').Stripe.Customer | import('stripe').Stripe.DeletedCustomer} */
  const stripeCustomer = await stripe.customers.retrieve(stripeCustomerId)
  if (stripeCustomer.deleted) {
    return {
      error: {
        name: 'StripeCustomerNotFound',
        message: `Customer ${stripeCustomerId} has been deleted from Stripe`,
      }
    }
  }

  // Create a deterministic idempotency key that's guaranteed to be under 255 chars
  // Hash the full event details to ensure uniqueness while staying within Stripe's limit
  // We need deterministic keys based on the event data to prevent duplicate billing.
  const idempotencyData = `${egressData.servedAt.toISOString()}-${egressData.space}-${egressData.customer}-${egressData.resource}-${egressData.cause}`
  const idempotencyKey = createHash('sha256').update(idempotencyData).digest('hex') // 64 chars

  /** @type {import('stripe').Stripe.Billing.MeterEvent} */
  const meterEvent = await retry(
    async () => {
      return await stripe.billing.meterEvents.create({
        event_name: billingMeterEventName,
        payload: {
          stripe_customer_id: stripeCustomerId,
          // Stripe expects the value to be a string
          value: egressData.bytes.toString(),
        },
        // Stripe expects the timestamp to be in seconds
        timestamp: Math.floor(egressData.servedAt.getTime() / 1000),
      },
        {
          idempotencyKey
        }
      )
    },
    {
      retries: 5,
      minTimeout: 1000, // 1 second
      maxTimeout: 30000, // 30 seconds max
      factor: 2, // Exponential backoff: 1s, 2s, 4s, 8s, 16s
      randomize: true, // Add jitter to prevent thundering herd
      onFailedAttempt: (error) => {
        console.warn(`Stripe rate limit hit. Attempt ${error.attemptNumber} failed. ${error.retriesLeft} retries left.`)
      },
      shouldRetry: (error) => {
        // @ts-ignore - error has the original Stripe error properties
        return error.type === 'StripeRateLimitError' || error.cause?.type === 'StripeRateLimitError'
      }
    }
  )

  // Identifier is only set if the event was successfully created
  if (meterEvent.identifier) {
    console.log('Meter event created:', meterEvent)
    return { ok: { meterEvent } }
  }
  return {
    error: {
      name: 'StripeBillingMeterEventCreationFailed',
      message: `Error creating meter event for egress traffic in Stripe for customer ${egressData.customer} @ ${egressData.servedAt.toISOString()}`,
    }
  }
}