import * as Sentry from '@sentry/serverless'
import { notNully } from './lib.js'
import * as SpaceBillingInstruction from '../data/space-billing-instruction.js'
import { createSpaceDiffStore } from '../tables/space-diff.js'
import { createSpaceSnapshotStore } from '../tables/space-snapshot.js'
import { createUsageStore } from '../tables/usage.js'

Sentry.AWSLambda.init({
  environment: process.env.SST_STAGE,
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 1.0
})

/**
 * @typedef {{
 *   spaceDiffTable?: string
 *   spaceSnapshotTable?: string
 *   usageTable?: string
 *   dbEndpoint?: URL
 *   region?: 'us-west-2'|'us-east-2'
 * }} CustomHandlerContext
 */

/**
 * @param {import('aws-lambda').SQSEvent} event
 * @param {import('aws-lambda').Context} context
 */
export const _handler = async (event, context) => {
  /** @type {CustomHandlerContext|undefined} */
  const customContext = context?.clientContext?.Custom
  const spaceDiffTable = customContext?.spaceDiffTable ?? notNully(process.env, 'SPACE_DIFF_TABLE_NAME')
  const spaceSnapshotTable = customContext?.spaceSnapshotTable ?? notNully(process.env, 'SPACE_SNAPSHOT_TABLE_NAME')
  const usageTable = customContext?.usageTable ?? notNully(process.env, 'USAGE_TABLE_NAME')
  const dbEndpoint = new URL(customContext?.dbEndpoint ?? notNully(process.env, 'DYNAMO_DB_ENDPOINT'))
  const region = customContext?.region ?? notNully(process.env, 'AWS_REGION')

  const { ok: instructions, error } = parseSpaceBillingInstructionEvent(event)
  if (error) throw error

  const storeOptions = { endpoint: dbEndpoint }
  const stores = {
    spaceDiffStore: createSpaceDiffStore(region, spaceDiffTable, storeOptions),
    spaceSnapshotStore: createSpaceSnapshotStore(region, spaceSnapshotTable, storeOptions),
    usageStore: createUsageStore(region, usageTable, storeOptions)
  }
  for (const instruction of instructions) {
    const { error } = await processSpaceBillingInstruction(instruction, stores)
    if (error) throw error
  }
}

export const handler = Sentry.AWSLambda.wrapHandler(_handler)

/**
 * @param {import('aws-lambda').SQSEvent} event
 * @returns {import('@ucanto/interface').Result<import('../types.js').SpaceBillingInstruction[], import('../types.js').DecodeFailure>}
 */
const parseSpaceBillingInstructionEvent = (event) => {
  const instructions = []
  for (const record of event.Records) {
    const res = SpaceBillingInstruction.decode(record.body)
    if (res.error) return res
    instructions.push(res.ok)
  }
  return { ok: instructions }
}

/**
 * @param {import('../types.js').SpaceBillingInstruction} instruction 
 * @param {{
 *   spaceDiffStore: import('../types.js').SpaceDiffStore
 *   spaceSnapshotStore: import('../types.js').SpaceSnapshotStore
 *   usageStore: import('../types.js').UsageStore
 * }} stores
 * @returns {Promise<import('@ucanto/interface').Result>}
 */
const processSpaceBillingInstruction = async (instruction, {
  spaceDiffStore,
  spaceSnapshotStore,
  usageStore
}) => {
  console.log(`processing space billing instruction for: ${instruction.customer}`)
  console.log(`period: ${instruction.from.toISOString()} - ${instruction.to.toISOString()}`)

  const { ok: snap, error } = await spaceSnapshotStore.get({
    space: instruction.space,
    provider: instruction.provider,
    recordedAt: instruction.from
  })
  if (error) return { error }

  console.log(`space ${snap.space} is ${snap.size} bytes @ ${snap.recordedAt.toISOString()}`)

  /** @type {import('../types.js').SpaceDiff[]} */
  const diffs = []

  let cursor
  while (true) {
    const { ok: listing, error: listErr } = await spaceDiffStore.listBetween(
      { customer: instruction.customer },
      instruction.from,
      instruction.to,
      { cursor, size: 1000 }
    )
    if (listErr) return { error: listErr }
    for (const diff of listing.results) {
      if (diff.provider !== snap.provider) continue
      diffs.push(diff)
    }
    if (!listing.cursor) break
    cursor = listing.cursor
  }

  console.log(`${diffs.length} space updates`)

  return { ok: {} }
}
