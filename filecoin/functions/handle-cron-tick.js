import * as Sentry from '@sentry/serverless'
import { Config } from 'sst/node/config'
import * as storefrontEvents from '@storacha/filecoin-api/storefront/events'
import * as DID from '@ipld/dag-ucan/did'
import * as Proof from '@storacha/client/proof'
import { createPieceTable } from '../store/piece.js'
import { createTaskStore } from '../store/task.js'
import { createReceiptStore } from '../store/receipt.js'
import { getServiceSigner } from '../service.js'
import { mustGetEnv } from '../../lib/env.js'

Sentry.AWSLambda.init({
  environment: process.env.SST_STAGE,
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 0,
})

const AWS_REGION = process.env.AWS_REGION || 'us-west-2'

export async function handleCronTick () {
  const { did, pieceTableName, agentMessageBucketName, agentIndexBucketName, aggregatorDid } = getEnv()
  const privateKey = Config.PRIVATE_KEY

  // AGGREGATOR_SERVICE_PROOF is only required in some environments
  let aggregatorProof
  try {
    aggregatorProof = Config.AGGREGATOR_SERVICE_PROOF
  } catch {
    // AGGREGATOR_SERVICE_PROOF not bound for this environment
  }

  // create context
  const storefrontSigner = getServiceSigner({
    did,
    privateKey,
  })

  const aggregatorServicePrincipal = DID.parse(aggregatorDid)
  const aggregatorServiceProofs = []
  if (aggregatorProof) {
    const proof = await Proof.parse(aggregatorProof)
    aggregatorServiceProofs.push(proof)
  }

  // Note that we need a self-signed invocation if we don't have a proof to invoke piece/offer on the aggregator service.
  // Thus, we always use the storefront/upload-service key as the issuer, but wrap it with the upload-service DID web if
  // there is a proof, and the aggregator service DID web if we don't have one.
  const context = {
    pieceStore: createPieceTable(AWS_REGION, pieceTableName),
    taskStore: createTaskStore(AWS_REGION, agentIndexBucketName, agentMessageBucketName),
    receiptStore: createReceiptStore(AWS_REGION, agentIndexBucketName, agentMessageBucketName),
    aggregatorInvocationConfig: {
      issuer: aggregatorServiceProofs.length
        ? storefrontSigner
        : getServiceSigner({
          did: aggregatorDid,
          privateKey,
        }),
      audience: aggregatorServicePrincipal,
      with: aggregatorServicePrincipal.did(),
      proofs: aggregatorServiceProofs
    }
  }

  const { ok, error } = await storefrontEvents.handleCronTick(context)
  if (error) {
    return {
      statusCode: 500,
      body: error.message || 'failed to handle cron tick'
    }
  }

  console.log(`updated: ${ok?.updatedCount}, pending: ${ok?.pendingCount}`)
  return { statusCode: 200 }
}

/**
 * Get Env validating it is set.
 */
function getEnv () {
  return {
    did: mustGetEnv('DID'),
    pieceTableName: mustGetEnv('PIECE_TABLE_NAME'),
    agentMessageBucketName: mustGetEnv('AGENT_MESSAGE_BUCKET_NAME'),
    agentIndexBucketName: mustGetEnv('AGENT_INDEX_BUCKET_NAME'),
    aggregatorDid: mustGetEnv('AGGREGATOR_DID'),
  }
}

export const main = Sentry.AWSLambda.wrapHandler(handleCronTick)
