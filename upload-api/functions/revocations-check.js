import * as Sentry from '@sentry/serverless'
import { createRevocationsTable } from '../stores/revocations.js'
import { mustGetEnv } from '../../lib/env.js'
import * as Link from 'multiformats/link'
import { CarWriter } from '@ipld/car'
import { encode } from '@ipld/dag-cbor'
import { sha256 } from 'multiformats/hashes/sha2'
import { CID } from 'multiformats/cid'
import { createDelegationsStore } from '../buckets/delegations-store.js'

Sentry.AWSLambda.init({
  environment: process.env.SST_STAGE,
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 0,
})

/**
 * AWS HTTP Gateway handler for GET /revocations/{cid}
 * 
 * Checks if a specific delegation CID is revoked and returns:
 * - 200 with CAR file containing revocation details if revoked
 * - 404 with plain text if not revoked
 * 
 * @param {import('aws-lambda').APIGatewayProxyEventV2} request
 */
export async function revocationsGet(request) {
  try {
    const cid = request.pathParameters?.cid
    if (!cid) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET',
          'Access-Control-Allow-Headers': 'Accept',
        },
        body: JSON.stringify({
          error: 'Missing CID parameter',
          message: 'CID parameter is required in the URL path'
        }),
      }
    }

    let parsedCID
    try {
      parsedCID = Link.parse(cid)
    } catch {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET',
          'Access-Control-Allow-Headers': 'Accept',
        },
        body: JSON.stringify({
          error: 'Invalid CID format',
          message: 'The provided CID is not a valid IPFS CID'
        }),
      }
    }

    const revocationTableName = mustGetEnv('REVOCATION_TABLE_NAME')
    const awsRegion = process.env.AWS_REGION || 'us-west-2'
    const dbEndpoint = process.env.DYNAMO_DB_ENDPOINT
    const revocationsStorage = createRevocationsTable(awsRegion, revocationTableName, {
      endpoint: dbEndpoint
    })

    const normalizedCID = parsedCID.toString()
    const query = { [normalizedCID]: true }
    const result = await revocationsStorage.query(query)
    if (!result.ok) {
      console.error('Failed to query revocations:', result.error)
      return {
        statusCode: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET',
          'Access-Control-Allow-Headers': 'Accept',
        },
        body: JSON.stringify({
          error: 'Internal server error',
          message: 'Failed to find revocation'
        }),
      }
    }

    const revocations = /** @type {import('@storacha/upload-api').MatchingRevocations | undefined} */ (result.ok)
    if (!revocations || Object.keys(revocations).length === 0) {
      // No revocations found - return 404
      return {
        statusCode: 404,
        headers: {
          'Content-Type': 'text/plain',
          'Cache-Control': 'public, max-age=300', // 5 minutes cache for non-revoked
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET',
          'Access-Control-Allow-Headers': 'Accept',
        },
        body: 'Delegation not revoked',
      }
    }
    const carBytes = await createRevocationCAR(normalizedCID, revocations)
    const etag = `"${await generateETag(carBytes)}"`

    // Return CAR file with aggressive caching: revoked delegations are immutable
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/vnd.ipld.car',
        'Cache-Control': 'public, max-age=31536000', // 1 year cache for revoked delegations
        'ETag': etag,
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET',
        'Access-Control-Allow-Headers': 'Accept',
      },
      body: Buffer.from(carBytes).toString('base64'),
      isBase64Encoded: true,
    }

  } catch (error) {
    console.error('Error in revocations endpoint:', error)
    Sentry.captureException(error)
    
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET',
        'Access-Control-Allow-Headers': 'Accept',
      },
      body: JSON.stringify({
        error: 'Internal server error',
        message: 'An unexpected error occurred'
      }),
    }
  }
}

/**
 * Creates a CAR file containing revocation data and proofs
 *
 * @param {string} delegationCID - The CID of the revoked delegation
 * @param {import('@storacha/upload-api').MatchingRevocations} revocations - Revocation data from storage
 * @returns {Promise<Uint8Array>} CAR file bytes
 */
async function createRevocationCAR(delegationCID, revocations) {
  const revocationList = []
  
  // Since we queried for a specific delegation CID, get its revocations
  const scopeRevocations = revocations[delegationCID]
  if (scopeRevocations) {
    for (const [scopeDID, revocationData] of Object.entries(scopeRevocations)) {
      const revoked = /** @type {{ cause: import('multiformats/link').Link }} */ (revocationData)
      revocationList.push({
        scope: scopeDID,
        cause: revoked.cause.toString(),
      })
    }
  }

  const rootBlock = {
    "revocations@0.0.1": {
      revocations: revocationList.map(rev => ({
        delegation: { "/": delegationCID },
        scope: rev.scope,
        cause: { "/": rev.cause }
      }))
    }
  }

  // Encode the root block using dag-cbor
  const rootBlockBytes = encode(rootBlock)
  
  // Create CID for the root block
  const hash = await sha256.digest(rootBlockBytes)
  const rootCID = CID.create(1, 0x71, hash) // version 1, dag-cbor codec (0x71)

  // Create CAR writer
  const { writer, out } = CarWriter.create([rootCID])
  let writerClosed = false
  try {
    // Add the root block
    writer.put({ cid: rootCID, bytes: rootBlockBytes })
    
    // Add additional blocks for trustless verification
    await addRevocationProofs(writer, delegationCID, revocations)

    // Close writer before reading output
    writer.close()
    writerClosed = true

    // Collect all bytes
    const chunks = []
    for await (const chunk of out) {
      chunks.push(chunk)
    }
    
    // Concatenate all chunks
    const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
    const result = new Uint8Array(totalLength)
    let offset = 0
    for (const chunk of chunks) {
      result.set(chunk, offset)
      offset += chunk.length
    }
    return result
  } catch (error) {
    // Close writer on error
    if (!writerClosed) {
      await writer.close()
    }
    console.error('Error creating CAR file:', error)
    throw error
  }
}

/**
 * Adds revocation proofs and related data to the CAR file for trustless verification
 *
 * @param {import('@ipld/car').CarWriter} writer - CAR writer instance
 * @param {string} delegationCID - The CID of the revoked delegation
 * @param {import('@storacha/upload-api').MatchingRevocations} revocations - Revocation data from storage
 */
async function addRevocationProofs(writer, delegationCID, revocations) {
  const delegationBucketName = mustGetEnv('DELEGATION_BUCKET_NAME')
  const awsRegion = process.env.AWS_REGION || 'us-west-2'
  const s3Endpoint = process.env.S3_ENDPOINT
  
  // For testing, use MinIO credentials when S3_ENDPOINT is set
  const s3Options = s3Endpoint ? {
    endpoint: s3Endpoint,
    forcePathStyle: true,
    credentials: {
      accessKeyId: 'minioadmin',
      secretAccessKey: 'minioadmin',
    },
  } : undefined
  
  const delegationsStore = createDelegationsStore(awsRegion, delegationBucketName, s3Options)
  
  const scopeRevocations = revocations[delegationCID]
  if (!scopeRevocations) return
  
  for (const [, revocationData] of Object.entries(scopeRevocations)) {
    const revoked = /** @type {{ cause: import('multiformats/cid').CID }} */ (revocationData)
    const causeCID = revoked.cause
    
    // Fetch the actual UCAN revocation proof from delegation store
    const delegationCarBytes = await delegationsStore.get(/** @type {import('multiformats/cid').CID} */ (causeCID))
    if (!delegationCarBytes) {
      throw new Error(`UCAN proof not found for CID ${causeCID}`)
    }
    // Add the delegation's archive (CAR bytes) to our CAR file
    // The delegation CAR contains the UCAN proof that clients can verify
    writer.put({ cid: causeCID, bytes: delegationCarBytes })
  }
}

/**
 * Generates an ETag for the CAR file content
 *
 * @param {Uint8Array} carBytes - CAR file bytes
 * @returns {Promise<string>} ETag hash
 */
async function generateETag(carBytes) {
  // Simple hash of the content for ETag
  // In production, you might want to use a more sophisticated approach
  const hash = await crypto.subtle.digest('SHA-256', carBytes)
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 16) // Truncate for shorter ETag
}

export const handler = Sentry.AWSLambda.wrapHandler(revocationsGet)
