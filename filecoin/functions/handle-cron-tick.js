import * as Sentry from '@sentry/serverless'
import { Config } from '@serverless-stack/node/config/index.js'
import * as storefrontEvents from '@web3-storage/filecoin-api/storefront/events'
import * as DID from '@ipld/dag-ucan/did'

import { createPieceTable } from '../store/piece.js'
import { createTaskStore } from '../store/task.js'
import { createReceiptStore } from '../store/receipt.js'
import { getServiceSigner } from '../service.js'
import { mustGetEnv } from './utils.js'

Sentry.AWSLambda.init({
  environment: process.env.SST_STAGE,
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 1.0,
})

const AWS_REGION = process.env.AWS_REGION || 'us-west-2'

async function handleCronTick () {
  const { pieceTableName, workflowBucketName, invocationBucketName, aggregatorDid } = getEnv()
  const { PRIVATE_KEY: privateKey } = Config

  // create context
  const storefrontSigner = getServiceSigner({
    privateKey
  })
  const context = {
    pieceStore: createPieceTable(AWS_REGION, pieceTableName),
    taskStore: createTaskStore(AWS_REGION, invocationBucketName, workflowBucketName),
    receiptStore: createReceiptStore(AWS_REGION, invocationBucketName, workflowBucketName),
    id: storefrontSigner,
    aggregatorId: DID.parse(aggregatorDid),
  }

  const { ok, error } = await storefrontEvents.handleCronTick(context)
  if (error) {
    return {
      statusCode: 500,
      body: error.message || 'failed to handle cron tick'
    }
  }

  return {
    statusCode: 200,
    body: ok
  }
}

/**
 * Get Env validating it is set.
 */
function getEnv () {
  return {
    pieceTableName: mustGetEnv('PIECE_TABLE_NAME'),
    workflowBucketName: mustGetEnv('WORKFLOW_BUCKET_NAME'),
    invocationBucketName: mustGetEnv('INVOCATION_BUCKET_NAME'),
    aggregatorDid: mustGetEnv('AGGREGATOR_DID')
  }
}

export const main = Sentry.AWSLambda.wrapHandler(handleCronTick)
