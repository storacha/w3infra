import * as Sentry from '@sentry/serverless'
import { expect } from './lib.js'
import * as SpaceBillingInstruction from '../data/space-billing-instruction.js'
import { createSpaceDiffStore } from '../tables/space-diff.js'
import { createSpaceSnapshotStore } from '../tables/space-snapshot.js'
import { createUsageStore } from '../tables/usage.js'
import { calculatePeriodUsage, storeSpaceUsage } from '../lib/space-billing-queue.js'
import { mustGetEnv } from '../../lib/env.js'

Sentry.AWSLambda.init({
  environment: process.env.SST_STAGE,
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 0
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
    const spaceDiffTable = customContext?.spaceDiffTable ?? mustGetEnv('SPACE_DIFF_TABLE_NAME')
    const spaceSnapshotTable = customContext?.spaceSnapshotTable ?? mustGetEnv('SPACE_SNAPSHOT_TABLE_NAME')
    const usageTable = customContext?.usageTable ?? mustGetEnv('USAGE_TABLE_NAME')
    const region = customContext?.region ?? mustGetEnv('AWS_REGION')

    const instructions = parseSpaceBillingInstructionEvent(event)

    const ctx = {
      spaceDiffStore: createSpaceDiffStore({ region }, { tableName: spaceDiffTable }),
      spaceSnapshotStore: createSpaceSnapshotStore({ region }, { tableName: spaceSnapshotTable }),
      usageStore: createUsageStore({ region }, { tableName: usageTable })
    }
    for (const instruction of instructions) {
      const calculation = expect(
        await calculatePeriodUsage(instruction, ctx),
        `calculating period usage: ${instruction.space} customer: ${instruction.customer} in period: ${instruction.from} - ${instruction.to}`
      )
      expect(
        await storeSpaceUsage(instruction, calculation, ctx),
        `storing calculated usage for: ${instruction.space} customer: ${instruction.customer} in period: ${instruction.from} - ${instruction.to}`
      )
    }
  }
)

/**
 * @param {import('aws-lambda').SQSEvent} event
 * @returns {import('../lib/api.js').SpaceBillingInstruction[]}
 */
const parseSpaceBillingInstructionEvent = (event) => {
  const instructions = []
  for (const record of event.Records) {
    const instruction = expect(
      SpaceBillingInstruction.decode(record.body),
      'decoding space billing instruction'
    )
    instructions.push(instruction)
  }
  return instructions
}
