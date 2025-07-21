import { startOfMonth } from '../lib/util.js'
import { Schema } from '../data/lib.js'

/**
 * @typedef {import('../lib/api.js').CustomerDID} CustomerDID
 */

/**
 * @param {string} value
 * @returns {boolean}
 */
function validateDateArg(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
}

/**
 * @param {string[]} args - Array of arguments in the format 'from=yyyy-mm-dd' or 'to=yyyy-mm-dd'.
 * @returns {{ from?: Date, to: Date, customer?: CustomerDID }} - Object with parsed 'from' and 'to' dates.
 * @throws {Error} If the arguments are invalid or improperly formatted.
 */
export function parseArgs(args) {
  const fromArg = args.find((e) => e.includes('from='))?.split('from=')[1]
  const toArg = args.find((e) => e.includes('to='))?.split('to=')[1]
  const customer = /** @type CustomerDID */ (
    args.find((e) => e.includes('customer='))?.split('customer=')[1]
  )

  if (
    (fromArg && !validateDateArg(fromArg)) ||
    (toArg && !validateDateArg(toArg))
  ) {
    throw new Error('Expected argument in the format yyyy-mm-dd')
  }

  if (customer && Schema.did({ method: 'mailto' }).read(customer).error) {
    throw new Error(`Invalid customer format: expected 'did:mailto:agent'.`)
  }

  const from = fromArg ? new Date(fromArg) : undefined
  const to = toArg
    ? new Date(toArg)
    : (() => {
        const now = new Date()
        now.setUTCMonth(now.getUTCMonth() + 1)
        return startOfMonth(now) // until first day of next month
      })()

  if (from && from > to) {
    throw new Error("'from' date must be earlier than 'to' date")
  }

  return {
    from,
    to,
    customer,
  }
}