/**
 * Stripe Product Setup Script with Billing Meters
 *
 * This script creates:
 * - 2 billing meters (storage and egress) for tracking usage
 * - 9 products across 3 tiers (mild, medium, extra-spicy)
 * - Each tier has 3 products: flat fee, storage, and egress
 *
 * Usage:
 *   export STRIPE_SECRET_KEY='sk_test_...'
 *   node tools/stripe/setup-products.js
 *
 * You can get STRIPE_SECRET_KEY from your Stripe sandbox workbench settings.
 * 
 * After setup, you can send meter events to record usage:
 *
 *   // Storage usage event
 *   await stripe.billing.meterEvents.create({
 *     event_name: 'storage_usage',
 *     payload: {
 *       stripe_customer_id: 'cus_xxx',
 *       bytes: 1073741824, // 1 GiB in bytes
 *     },
 *   })
 *
 *   // Egress usage event
 *   await stripe.billing.meterEvents.create({
 *     event_name: 'egress_usage',
 *     payload: {
 *       stripe_customer_id: 'cus_xxx',
 *       bytes: 536870912, // 0.5 GiB in bytes
 *     },
 *   })
 */
import Stripe from 'stripe'

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY

if (!STRIPE_SECRET_KEY) {
  console.error('Error: STRIPE_SECRET_KEY environment variable is required')
  // eslint-disable-next-line unicorn/no-process-exit
  process.exit(1)
}

const stripe = new Stripe(STRIPE_SECRET_KEY, {
  apiVersion: '2025-02-24.acacia', // Use latest API version with billing meters
})

// Product configuration for 3 tiers
const TIERS = {
  mild: {
    name: 'Mild',
    flatFee: 0,
    storageRate: 0.03, // $ per GiB per month
    egressRate: 0.03,  // $ per GiB
  },
  medium: {
    name: 'Medium',
    flatFee: 10,
    storageRate: 0.05,
    egressRate: 0.05,
  },
  'extra-spicy': {
    name: 'Extra Spicy',
    flatFee: 100,
    storageRate: 0.15,
    egressRate: 0.15,
  },
}

/**
 * Converts GiB rate to bytes rate
 * 1 GiB = 1,073,741,824 bytes (2^30)
 * 
 * @param {number} gibRate
 * @returns {number}
 */
function gibToBytesRate(gibRate) {
  const BYTES_PER_GIB = 1073741824
  return gibRate / BYTES_PER_GIB
}

/**
 * Creates a Stripe product with its associated price
 * 
 * @param {string} tierKey
 * @param {{ name: string, flatFee: number, storageRate: number, egressRate: number }} tier
 * @param {string} productType
 * @param {{ id: string } | null} meter - The billing meter to use (for metered products)
 */
async function createProduct(tierKey, tier, productType, meter = null) {
  const productName = `${tier.name} - ${productType.charAt(0).toUpperCase() + productType.slice(1)}`

  console.log(`Creating product: ${productName}`)

  const product = await stripe.products.create({
    name: productName,
    metadata: {
      tier: tierKey,
      type: productType,
    },
  })

  /** @type {import('stripe').Stripe.PriceCreateParams} */
  let priceData

  // eslint-disable-next-line unicorn/prefer-switch
  if (productType === 'flat-fee') {
    // Flat monthly subscription fee
    priceData = {
      product: product.id,
      currency: 'usd',
      recurring: {
        interval: 'month',
        usage_type: 'licensed',
      },
      unit_amount: Math.round(tier.flatFee * 100), // Convert to cents
      metadata: {
        tier: tierKey,
        type: productType,
      },
    }
  } else if (productType === 'storage') {
    // Storage usage: billed per byte per month using billing meter
    if (!meter) {
      throw new Error('Storage product requires a billing meter')
    }
    const bytesRate = gibToBytesRate(tier.storageRate)
    priceData = {
      product: product.id,
      currency: 'usd',
      recurring: {
        interval: 'month',
        usage_type: 'metered',
        meter: meter.id, // Reference the billing meter
      },
      billing_scheme: 'per_unit',
      unit_amount_decimal: bytesRate.toFixed(12), // High precision for tiny per-byte amounts
      metadata: {
        tier: tierKey,
        type: productType,
        rate_per_gib: tier.storageRate.toString(),
      },
    }
  } else if (productType === 'egress') {
    // Egress usage: billed per byte using billing meter
    if (!meter) {
      throw new Error('Egress product requires a billing meter')
    }
    const bytesRate = gibToBytesRate(tier.egressRate)
    priceData = {
      product: product.id,
      currency: 'usd',
      recurring: {
        interval: 'month',
        usage_type: 'metered',
        meter: meter.id, // Reference the billing meter
      },
      billing_scheme: 'per_unit',
      unit_amount_decimal: bytesRate.toFixed(12), // High precision for tiny per-byte amounts
      metadata: {
        tier: tierKey,
        type: productType,
        rate_per_gib: tier.egressRate.toString(),
      },
    }
  } else {
    throw new Error(`Unknown product type: ${productType}`)
  }

  const price = await stripe.prices.create(priceData)

  console.log(`  Product ID: ${product.id}`)
  console.log(`  Price ID: ${price.id}`)

  return { product, price }
}

/**
 * Creates billing meters for storage and egress usage
 */
async function createBillingMeters() {
  console.log('=== Creating Billing Meters ===\n')

  // Create storage meter
  console.log('Creating storage billing meter...')
  const storageMeter = await stripe.billing.meters.create({
    display_name: 'Storage Usage',
    event_name: 'storage_usage',
    default_aggregation: {
      formula: 'sum',
    },
    customer_mapping: {
      type: 'by_id',
      event_payload_key: 'stripe_customer_id',
    },
    value_settings: {
      event_payload_key: 'bytes',
    },
  })
  console.log(`  Storage Meter ID: ${storageMeter.id}\n`)

  // Create egress meter
  console.log('Creating egress billing meter...')
  const egressMeter = await stripe.billing.meters.create({
    display_name: 'Egress Usage',
    event_name: 'egress_usage',
    default_aggregation: {
      formula: 'sum',
    },
    customer_mapping: {
      type: 'by_id',
      event_payload_key: 'stripe_customer_id',
    },
    value_settings: {
      event_payload_key: 'bytes',
    },
  })
  console.log(`  Egress Meter ID: ${egressMeter.id}\n`)

  return { storageMeter, egressMeter }
}

/**
 * Main function to set up all products
 */
async function setupProducts() {
  console.log('Setting up Stripe products...\n')

  // First create the billing meters
  const { storageMeter, egressMeter } = await createBillingMeters()

  /**
   * @type {Record<string, Record<string, {product: Stripe.Response<Stripe.Product>, price: Stripe.Response<Stripe.Price>}>>}
   */
  const results = {}

  for (const [tierKey, tier] of Object.entries(TIERS)) {
    console.log(`\n=== ${tier.name} Tier ===\n`)

    results[tierKey] = {}

    // Create flat fee product
    const flatFee = await createProduct(tierKey, tier, 'flat-fee', null)
    results[tierKey]['flat-fee'] = flatFee
    console.log()

    // Create storage product with storage meter
    const storage = await createProduct(tierKey, tier, 'storage', storageMeter)
    results[tierKey].storage = storage
    console.log()

    // Create egress product with egress meter
    const egress = await createProduct(tierKey, tier, 'egress', egressMeter)
    results[tierKey].egress = egress
    console.log()
  }

  console.log('\n=== Summary ===\n')
  console.log(JSON.stringify(results, null, 2))

  // Create a simplified reference for configuration
  console.log('\n=== Configuration Reference ===\n')

  console.log('Billing Meters:')
  console.log(`  Storage Meter: ${storageMeter.id}`)
  console.log(`  Egress Meter: ${egressMeter.id}\n`)

  console.log('Price IDs by Tier:')
  for (const [tierKey, tierProducts] of Object.entries(results)) {
    console.log(`${tierKey}:`)
    for (const [productType, { price }] of Object.entries(tierProducts)) {
      console.log(`  ${productType}: ${price.id}`)
    }
    console.log()
  }

  // Output in the format used in constants.js
  console.log('\n=== Price Specification (for constants.js) ===\n')
  console.log('\nThese can be copied into a new section of PLANS_TO_LINE_ITEMS_MAPPING in upload-api/constants.js\n')

  /** @type {Record<string, string>} */
  const tierToPlanMapping = {
    'mild': 'did:web:starter.storacha.network',
    'medium': 'did:web:lite.storacha.network',
    'extra-spicy': 'did:web:business.storacha.network'
  }

  for (const [tierKey, tierProducts] of Object.entries(results)) {
    const planDid = tierToPlanMapping[tierKey]
    console.log(`"${planDid}": [`)
    console.log(`  // flat fee`)
    console.log(`  { "price": "${tierProducts['flat-fee'].price.id}", "quantity": 1 },`)
    console.log(`  // storage overage`)
    console.log(`  { "price": "${tierProducts.storage.price.id}" },`)
    console.log(`  // egress overage`)
    console.log(`  { "price": "${tierProducts.egress.price.id}" }`)
    console.log(`],`)
  }

  console.log('\n✅ All products and meters created successfully!')

  return {
    meters: { storage: storageMeter, egress: egressMeter },
    products: results,
  }
}

// Run the setup
await setupProducts()
