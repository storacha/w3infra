import * as Sentry from '@sentry/serverless'
import { notNully } from './lib.js'
import * as SpaceBillingInstruction from '../data/space-billing-instruction.js'
import { createSpaceDiffStore } from '../tables/space-diff.js'
import { createSpaceSnapshotStore } from '../tables/space-snapshot.js'
import { createUsageStore } from '../tables/usage.js'
import { handleSpaceBillingInstruction } from '../lib/space-billing-queue.js'

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
 *   region?: 'us-west-2'|'us-east-2'
 * }} CustomHandlerContext
 */

export const handler = Sentry.AWSLambda.wrapHandler(
  /**
   * @param {import('aws-lambda').SQSEvent} event
   * @param {import('aws-lambda').Context} context
   */
  async (event, context) => {
    /** @type {CustomHandlerContext|undefined} */
    const customContext = context?.clientContext?.Custom
    const spaceDiffTable = customContext?.spaceDiffTable ?? notNully(process.env, 'SPACE_DIFF_TABLE_NAME')
    const spaceSnapshotTable = customContext?.spaceSnapshotTable ?? notNully(process.env, 'SPACE_SNAPSHOT_TABLE_NAME')
    const usageTable = customContext?.usageTable ?? notNully(process.env, 'USAGE_TABLE_NAME')
    const region = customContext?.region ?? notNully(process.env, 'AWS_REGION')

    const { ok: instructions, error } = parseSpaceBillingInstructionEvent(event)
    if (error) throw error

    const ctx = {
      spaceDiffStore: createSpaceDiffStore({ region }, { tableName: spaceDiffTable }),
      spaceSnapshotStore: createSpaceSnapshotStore({ region }, { tableName: spaceSnapshotTable }),
      usageStore: createUsageStore({ region }, { tableName: usageTable })
    }
    for (const instruction of instructions) {
      const { error } = await handleSpaceBillingInstruction(instruction, ctx)
      if (error) throw error
    }
  }
)

/**
 * @param {import('aws-lambda').SQSEvent} event
 * @returns {import('@ucanto/interface').Result<import('../lib/api.js').SpaceBillingInstruction[], import('../lib/api.js').DecodeFailure>}
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
