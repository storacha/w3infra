import Big from 'big.js'
import { asDIDMailto } from '../../data/lib.js'
import { mustGetEnv } from '../../functions/lib.js'
import { createStoreListerClient } from '../../tables/client.js'
import { getDynamo } from './lib.js'
import { decode, lister } from '../../data/usage.js'

const GB = 1024 * 1024 * 1024
const perGBMonth = 10

/**
 * @param {string} customerParam
 * @param {string} fromParam
 */
export const usage = async (customerParam, fromParam) => {
  const customer = asDIDMailto(customerParam)
  const from = new Date(fromParam)
  if (isNaN(from.getTime())) {
    console.error('invalid ISO date')
    process.exit(1)
  }

  const tableName = mustGetEnv('USAGE_TABLE_NAME')
  const dynamo = getDynamo()

  const store = createStoreListerClient(dynamo, {
    tableName,
    encodeKey: lister.encodeKey,
    decode
  })

  const { ok: listing, error } = await store.list({ customer, from })
  if (error) {
    console.error(error.message)
    process.exit(1)
  }

  console.log(`Customer: ${customer}`)
  console.log('Usage:')

  let total = 0
  if (listing.results.length) {
    for (const usage of listing.results) {
      const duration = usage.to.getTime() - usage.from.getTime()
      const cost = new Big(usage.usage.toString()).div(duration).div(GB).mul(perGBMonth).toNumber()
      total += cost
      console.log(`  ${usage.provider} ${usage.space} ${usage.usage} $${cost.toFixed(2)}`)
    }
  } else {
    console.log('  No usage in period')
  }
  console.log(`Total: $${total.toFixed(2)}`)
}
