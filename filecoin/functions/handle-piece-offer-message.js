import * as Sentry from '@sentry/serverless'
import { Config } from 'sst/node/config'
import * as Proof from '@storacha/client/proof'

import * as storefrontEvents from '@storacha/filecoin-api/storefront/events'

import { decodeMessage } from '../queue/piece-offer-queue.js'
import { getServiceConnection, getServiceSigner } from '../service.js'
import { mustGetEnv, mustGetConfig } from '../../lib/env.js'

Sentry.AWSLambda.init({
  environment: process.env.SST_STAGE,
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 0,
})

/**
 * Get EventRecord from the SQS Event triggering the handler.
 * On piece offer queue message, offer piece for aggregation.
 *
 * @param {import('aws-lambda').SQSEvent} sqsEvent
 */
async function handlePieceOfferMessage (sqsEvent) {
  if (sqsEvent.Records.length !== 1) {
    return {
      statusCode: 400,
      body: `Expected 1 SQS message per invocation but received ${sqsEvent.Records.length}`
    }
  }

  // Parse record
  const record = decodeMessage({
    MessageBody: sqsEvent.Records[0].body
  })

  // Create context
  const { did, aggregatorDid, aggregatorUrl } = getEnv()
  const privateKey = Config.PRIVATE_KEY

  // AGGREGATOR_SERVICE_PROOF is only required in some environments
  let aggregatorProof
  try {
    aggregatorProof = Config.AGGREGATOR_SERVICE_PROOF
  } catch {
    // AGGREGATOR_SERVICE_PROOF not bound for this environment
  }

  const storefrontSigner = getServiceSigner({
    did,
    privateKey,
  })

  const aggregatorConnection = getServiceConnection({
    did: aggregatorDid,
    url: aggregatorUrl
  })

  const aggregatorServiceProofs = []
  if (aggregatorProof) {
    const proof = await Proof.parse(aggregatorProof)
    aggregatorServiceProofs.push(proof)
  }

  const context = {
    aggregatorService: {
      connection: aggregatorConnection,
      invocationConfig: {
        issuer: aggregatorServiceProofs.length
          ? storefrontSigner
          : getServiceSigner({
            did: aggregatorDid,
            privateKey,
          }),
        audience: aggregatorConnection.id,
        with: aggregatorConnection.id.did(),
        proofs: aggregatorServiceProofs
      },
    }
  }

  const { ok, error } = await storefrontEvents.handlePieceOfferMessage(context, record)
  if (error) {
    return {
      statusCode: 500,
      body: error.message || 'failed to handle piece offer message'
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
    did: mustGetEnv('DID'),
    aggregatorDid: mustGetConfig('AGGREGATOR_DID'),
    aggregatorUrl: mustGetEnv('AGGREGATOR_URL'),
  }
}

export const main = Sentry.AWSLambda.wrapHandler(handlePieceOfferMessage)
