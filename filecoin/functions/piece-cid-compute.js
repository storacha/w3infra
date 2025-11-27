import * as Sentry from '@sentry/serverless'
import { Config } from 'sst/node/config'
import * as Proof from '@storacha/client/proof'
import { Storefront } from '@storacha/filecoin-client'
import * as DID from '@ipld/dag-ucan/did'

import { computePieceCid } from '../index.js'
import { getServiceConnection, getServiceSigner } from '../service.js'
import { mustGetEnv } from '../../lib/env.js'
import { getS3Client } from '../../lib/aws/s3.js'

Sentry.AWSLambda.init({
  environment: process.env.SST_STAGE,
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 0,
})

/**
 * Get EventRecord from the SQS Event triggering the handler.
 * Trigger `filecoin/offer` from bucket event
 *
 * @param {import('aws-lambda').SQSEvent} event
 */
async function computeHandler (event) {
  const { PRIVATE_KEY: privateKey, STOREFRONT_PROOF: storefrontProof } = Config
  const { storefrontDid, storefrontUrl, disablePieceCidCompute } = getEnv()

  if (disablePieceCidCompute) {
    const body = 'piece cid computation is disabled'
    console.log(body)
    return {
      statusCode: 200,
      body
    }
  }

  // Create context
  let storefrontSigner = getServiceSigner({
    privateKey
  })
  const connection = getServiceConnection({
    did: storefrontDid,
    url: storefrontUrl
  })
  const storefrontServiceProofs = []
  if (storefrontProof) {
    const proof = await Proof.parse(storefrontProof)
    storefrontServiceProofs.push(proof)
  } else {
    // if no proofs, we must be using the service private key to sign
    storefrontSigner = storefrontSigner.withDID(DID.parse(storefrontDid).did())
  }
  const storefrontService = {
    connection,
      invocationConfig: {
        issuer: storefrontSigner,
        with: storefrontSigner.did(),
        audience: storefrontSigner,
        proofs: storefrontServiceProofs
      },
  }

  // Decode record
  const record = parseEvent(event)
  if (!record) {
    throw new Error('Unexpected sqs record format')
  }

  const s3Client = getS3Client({ region: record.bucketRegion })

  // Compute piece for record
  const { error, ok } = await computePieceCid({
    record,
    s3Client,
  })
  if (error) {
    console.error(error)

    return {
      statusCode: 500,
      body: error.message
    }
  }

  // Invoke `filecoin/offer`
  const filecoinSubmitInv = await Storefront.filecoinOffer(
    storefrontService.invocationConfig,
    ok.content,
    ok.piece,
    { connection: storefrontService.connection }
  )

  if (filecoinSubmitInv.out.error) {
    return {
      statusCode: 500,
      body: filecoinSubmitInv.out.error,
    }
  }

  return {
    statusCode: 200,
  }
}

export const handler = Sentry.AWSLambda.wrapHandler(computeHandler)

/**
 * Get Env validating it is set.
 */
function getEnv () {
  return {
    storefrontDid: mustGetEnv('STOREFRONT_DID'),
    storefrontUrl: mustGetEnv('STOREFRONT_URL'),
    disablePieceCidCompute: process.env.DISABLE_PIECE_CID_COMPUTE === 'true'
  }
}

/**
 * Extract an EventRecord from the passed SQS Event
 *
 * @param {import('aws-lambda').SQSEvent} sqsEvent
 * @returns {import('../index.js').EventRecord | undefined}
 */
function parseEvent (sqsEvent) {
  if (sqsEvent.Records.length !== 1) {
    throw new Error(
      `Expected 1 CAR per invocation but received ${sqsEvent.Records.length} CARs`
    )
  }

  const body = sqsEvent.Records[0].body
  if (!body) {
    return
  }
  const { key, bucketName, bucketRegion } = JSON.parse(body)

  return {
    bucketRegion,
    bucketName,
    key,
  }
}
