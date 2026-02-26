/**
 * Encode/decode for egress-traffic-monthly-summary table
 */

/**
 * @typedef {object} EgressTrafficMonthlySummary
 * @property {string} customer - Customer DID
 * @property {string} space - Space DID
 * @property {string} month - YYYY-MM format
 * @property {bigint} bytes - Total bytes
 * @property {number} eventCount - Number of events
 */

/**
 * Encode summary for DynamoDB storage
 * @param {EgressTrafficMonthlySummary} summary
 */
export function encode(summary) {
  return {
    pk: `customer#${summary.customer}`,
    sk: `${summary.month}#${summary.space}`,
    space: summary.space,
    month: summary.month,
    bytes: summary.bytes,
    eventCount: summary.eventCount
  }
}

/**
 * Decode summary from DynamoDB
 * @param {object} item
 * @returns {EgressTrafficMonthlySummary}
 */
export function decode(item) {
  const [, customer] = item.pk.split('#')
  const [month, space] = item.sk.split('#')

  return {
    customer,
    space,
    month,
    bytes: BigInt(item.bytes),
    eventCount: item.eventCount
  }
}

/**
 * Extract month from ISO timestamp
 * @param {Date} date
 * @returns {string} YYYY-MM format
 */
export function extractMonth(date) {
  return date.toISOString().slice(0, 7)
}
