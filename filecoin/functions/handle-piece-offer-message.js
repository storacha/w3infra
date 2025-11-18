import * as Sentry from '@sentry/serverless'
import { Config } from 'sst/node/config'
import * as Proof from '@storacha/client/proof'
import * as DID from '@ipld/dag-ucan/did'

import * as storefrontEvents from '@storacha/filecoin-api/storefront/events'

import { decodeMessage } from '../queue/piece-offer-queue.js'
import { getServiceConnection, getServiceSigner } from '../service.js'
import { mustGetEnv } from '../../lib/env.js'

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
  const { PRIVATE_KEY: privateKey, STOREFRONT_PROOF: storefrontProof } = Config
  const { aggregatorDid, aggregatorUrl, did } = getEnv()
  let storefrontSigner = getServiceSigner({
    privateKey
  })
  const connection = getServiceConnection({
    did: aggregatorDid,
    url: aggregatorUrl
  })
  const aggregatorServiceProofs = []
  if (storefrontProof) {
    const proof = await Proof.parse(storefrontProof)
    aggregatorServiceProofs.push(proof)
  } else {
    // if no proofs, we must be using the service private key to sign
    storefrontSigner = storefrontSigner.withDID(DID.parse(did).did())
  }

  const context = {
    aggregatorService: {
      connection,
      invocationConfig: {
        issuer: storefrontSigner,
        with: storefrontSigner.did(),
        audience: connection.id,
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
    aggregatorDid: mustGetEnv('AGGREGATOR_DID'),
    aggregatorUrl: mustGetEnv('AGGREGATOR_URL'),
  }
}

export const main = Sentry.AWSLambda.wrapHandler(handlePieceOfferMessage)
