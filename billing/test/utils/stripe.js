import {
  accountIDToStripeCustomerID,
  stripeIDToAccountID,
  handleCustomerSubscriptionCreated
} from '../../utils/stripe.js'
import * as DidMailto from '@storacha/did-mailto'


/** @type {import('../lib/api.js').TestSuite<import('../lib/api.js').StripeTestContext>} */
export const test = {
  'should create a customer record': async (/** @type {import('entail').assert} */ assert, ctx) => {
    const stripeCustomerId = 'stripe-customer-id'
    const product = 'did:web:test-product'
    const email = 'travis@example.com'
    const customer = DidMailto.fromEmail(/** @type {`${string}@${string}`} */(email))
    const priceId = 'price_test'

    const getResult = await ctx.customerStore.get({ customer })
    assert.equal(getResult.error?.name, 'RecordNotFound')

    const result = await handleCustomerSubscriptionCreated(
      {
        customers: {
          // @ts-expect-error the return value would normally have more values, but we don't use them
          retrieve: async (s) => ({
            id: stripeCustomerId,
            email: 'travis@example.com',
          })
        }
      },
      {
        data: {
          object: {
            customer: stripeCustomerId,
            items: {
              data: [
                {
                  price: {
                    id: priceId
                  }
                }
              ]
            }
          }
        }
      },
      ctx.customerStore,
      {[priceId]: product}
    )
    assert.ok(result.ok)
    const customerRecord = await ctx.customerStore.get({ customer })
    assert.equal(customerRecord.ok?.product, product)
  },

  'should update a customer record if the account matches the existing customer record': async (/** @type {import('entail').assert} */ assert, ctx) => {
    const stripeCustomerId = 'stripe-customer-id'
    const product = 'did:web:test-product'
    const email = 'travis@example.com'
    const customer = DidMailto.fromEmail(/** @type {`${string}@${string}`} */(email))

    const stripeAccountId = `stripe:${stripeCustomerId}`
    const setResult = await ctx.customerStore.put({
      customer,
      account: stripeAccountId,
      product,
      insertedAt: new Date()
    })
    assert.ok(setResult.ok)

    const getResult = await ctx.customerStore.get({ customer })
    assert.equal(getResult.ok?.product, product)
    assert.equal(getResult.ok?.account, stripeAccountId)

    const updatedProduct = 'did:web:updated-test-product'
    const priceId = 'price_test'
    const result = await handleCustomerSubscriptionCreated(
      {
        customers: {
          // @ts-expect-error the return value would normally have more values, but we don't use them
          retrieve: async (s) => ({
            id: stripeCustomerId,
            email: 'travis@example.com',
          })
        }
      },
      {
        data: {
          object: {
            customer: stripeCustomerId,
            items: {
              data: [
                {
                  price: {
                    id: priceId
                  }
                }
              ]
            }
          }
        }
      },
      ctx.customerStore,
      {[priceId]: updatedProduct}
    )
    assert.ok(result.ok)
    const customerRecord = await ctx.customerStore.get({ customer })
    assert.equal(customerRecord.ok?.product, updatedProduct)
  },

  'should update a customer record if the stripe account is not set': async (/** @type {import('entail').assert} */ assert, ctx) => {
    const stripeCustomerId = 'stripe-customer-id'
    const product = 'did:web:test-product'
    const email = 'travis@example.com'
    const customer = DidMailto.fromEmail(/** @type {`${string}@${string}`} */(email))

    const setResult = await ctx.customerStore.put({
      customer,
      product,
      insertedAt: new Date()
    })
    assert.ok(setResult.ok)

    const getResult = await ctx.customerStore.get({ customer })
    assert.equal(getResult.ok?.product, product)
    assert.equal(getResult.ok?.account, undefined)

    const updatedProduct = 'did:web:updated-test-product'
    const priceId = 'price_test'
    const result = await handleCustomerSubscriptionCreated(
      {
        customers: {
          // @ts-expect-error the return value would normally have more values, but we don't use them
          retrieve: async (s) => ({
            id: stripeCustomerId,
            email: 'travis@example.com',
          })
        }
      },
      {
        data: {
          object: {
            customer: stripeCustomerId,
            items: {
              data: [
                {
                  price: {
                    id: priceId
                  }
                }
              ]
            }
          }
        }
      },
      ctx.customerStore,
      {[priceId]: updatedProduct}
    )
    assert.ok(result.ok)
    const customerRecord = await ctx.customerStore.get({ customer })
    assert.equal(customerRecord.ok?.account, `stripe:${stripeCustomerId}`)
    assert.equal(customerRecord.ok?.product, updatedProduct)
  },
  
  'should return an error if the stripe account is being changed': async (/** @type {import('entail').assert} */ assert, ctx) => {
    const stripeCustomerId = 'stripe-customer-id'
    const product = 'did:web:test-product'
    const email = 'travis@example.com'
    const customer = DidMailto.fromEmail(/** @type {`${string}@${string}`} */(email))

    const stripeAccountId = `stripe:${stripeCustomerId}`
    const setResult = await ctx.customerStore.put({
      customer,
      account: stripeAccountId,
      product,
      insertedAt: new Date()
    })
    assert.ok(setResult.ok)

    const getResult = await ctx.customerStore.get({ customer })
    assert.equal(getResult.ok?.product, product)
    assert.equal(getResult.ok?.account, stripeAccountId)

    const updatedProduct = 'did:web:updated-test-product'
    const updatedStripeCustomerId = 'updated-stripe-customer-id'
    const priceId = 'price_test'
    const result = await handleCustomerSubscriptionCreated(
      {
        customers: {
          // @ts-expect-error the return value would normally have more values, but we don't use them
          retrieve: async (s) => ({
            id: stripeCustomerId,
            email: 'travis@example.com',
          })
        }
      },
      {
        data: {
          object: {
            customer: updatedStripeCustomerId,
            items: {
              data: [
                {
                  price: {
                    id: priceId
                  }
                }
              ]
            }
          }
        }
      },
      ctx.customerStore,
      {[priceId]: updatedProduct}
    )
    assert.ok(result.error)
    assert.equal(result.error.message, 'expected did:mailto:example.com:travis to have account stripe:stripe-customer-id but got stripe:updated-stripe-customer-id')
    const customerRecord = await ctx.customerStore.get({ customer })
    assert.equal(customerRecord.ok?.product, product)
  },

  'should convert an account ID to a stripe customer ID': (/** @type {import('entail').assert} */ assert) => {
    const accountID = 'stripe:cus_1234567890'
    const stripeCustomerId = accountIDToStripeCustomerID(accountID)
    assert.equal(stripeCustomerId, 'cus_1234567890')
  },

  'should convert a stripe customer ID to an account ID': (/** @type {import('entail').assert} */ assert) => {
    const stripeCustomerId = 'cus_1234567890'
    const accountID = stripeIDToAccountID(stripeCustomerId)
    assert.equal(accountID, 'stripe:cus_1234567890')
  }
  ,
  'should update a customer record by account even when the Stripe email changes': async (/** @type {import('entail').assert} */ assert, ctx) => {
    const stripeCustomerId = 'stripe-customer-id'
    const oldEmail = 'alice@example.com'
    const newEmail = 'bob@example.com'
    const oldCustomerDID = DidMailto.fromEmail(/** @type {`${string}@${string}`} */(oldEmail))
    const newCustomerDID = DidMailto.fromEmail(/** @type {`${string}@${string}`} */(newEmail))

    // Pre-existing customer record linked by Stripe account
    const initialProduct = 'did:web:starter'
    const putRes = await ctx.customerStore.put({
      customer: oldCustomerDID,
      account: `stripe:${stripeCustomerId}`,
      product: initialProduct,
      insertedAt: new Date()
    })
    assert.ok(putRes.ok)

    // Subscription created arrives with same Stripe account but a different email
    const priceId = 'price_pro'
    const updatedProduct = 'did:web:pro'
    const result = await handleCustomerSubscriptionCreated(
      {
        customers: {
          // @ts-expect-error minimal shape is sufficient for test
          retrieve: async () => ({ id: stripeCustomerId, email: newEmail })
        }
      },
      {
        data: {
          object: {
            customer: stripeCustomerId,
            items: { data: [{ price: { id: priceId } }] }
          }
        }
      },
      ctx.customerStore,
      { [priceId]: updatedProduct }
    )
    assert.ok(result.ok)

    // Existing record should be updated (except DID which remains the same)
    const existing = await ctx.customerStore.get({ customer: oldCustomerDID })
    assert.equal(existing.ok?.product, updatedProduct)

    // No new record should be created for the new email/DID
    const missing = await ctx.customerStore.get({ customer: newCustomerDID })
    assert.equal(missing.error?.name, 'RecordNotFound')
  }
}
