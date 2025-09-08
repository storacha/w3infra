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
  tracesSampleRate: 1.0,
})

/**
 * @typedef {import('@ucanto/interface').Delegation} Delegation
 * @typedef {import('aws-lambda').APIGatewayProxyEvent} APIGatewayProxyEvent
 * @typedef {import('@storacha/upload-api/types').MatchingRevocations} MatchingRevocations
 * @typedef {import('../types.js').DelegationsBucket} DelegationsBucket
 * @typedef {import('@storacha/upload-api').RevocationsStorage} RevocationsStorage
 */

/**
 * @typedef {object} RevocationsContext
 * @property {RevocationsStorage} revocationsStorage
 * @property {DelegationsBucket} delegationsStore
 */

/**
 * @param {object} [options]
 * @param {Partial<import('../../lib/aws/s3.js').Address>} [options.s3]
 * @returns {RevocationsContext}
 */
function createContext(options = {}) {
  const tableName = mustGetEnv('REVOCATION_TABLE_NAME')
  const delegationBucketName = mustGetEnv('DELEGATION_BUCKET_NAME')
  const awsRegion = process.env.AWS_REGION || 'us-west-2'
  const dbEndpoint = process.env.DYNAMO_DB_ENDPOINT

  const revocationsStorage = createRevocationsTable(awsRegion, tableName, {
    endpoint: dbEndpoint,
  })

  const delegationsStore = createDelegationsStore(awsRegion, delegationBucketName, options.s3)

  return { revocationsStorage, delegationsStore }
}

/**
 * AWS HTTP Gateway handler for GET /revocations/{cid}
 * 
 * Checks if a specific delegation CID is revoked and returns:
 * - 200 with CAR file containing revocation details if revoked
 * - 404 with plain text if not revoked
 * 
 * @param {import('aws-lambda').APIGatewayProxyEventV2} request
 * @param {import('aws-lambda').Context} context
 * @param {import('aws-lambda').Callback} callback
 * @param {{ deps?: RevocationsContext, s3?: Partial<import('../../lib/aws/s3.js').Address> }} [options]
 */
export async function revocationsGet(request, context, callback, options = {}) {
  try {
    const ctx = options.deps || createContext(options)
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
          error: 'Bad request',
          message: 'CID parameter is required'
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
          error: 'Bad request',
          message: 'Invalid CID parameter'
        }),
      }
    }

    const normalizedCID = parsedCID.toString()
    const query = { [normalizedCID]: true }
    const result = await ctx.revocationsStorage.query(query)
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
        body: 'No revocation record found',
      }
    }
    const carBytes = await createRevocationCAR(normalizedCID, revocations, ctx.delegationsStore)
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
 * @param {import('../types.js').DelegationsBucket} delegationsStore
 * @returns {Promise<Uint8Array>} CAR file bytes
 */
async function createRevocationCAR(delegationCID, revocations, delegationsStore) {
  const revocationList = []
  
  // Since we queried for a specific delegation CID, get its revocations
  const scopeRevocations = revocations[delegationCID]
  if (scopeRevocations) {
    for (const [, revocationData] of Object.entries(scopeRevocations)) {
      const revoked = /** @type {{ cause: import('multiformats/link').Link }} */ (revocationData)
      revocationList.push({
        cause: revoked.cause.toString(),
      })
    }
  }

  const rootBlock = {
    "revocations@0.0.1": {
      revocations: revocationList.map(rev => ({
        delegation: { "/": delegationCID },
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
    await addRevocationProofs(writer, delegationCID, revocations, delegationsStore)

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
 * @param {import('../types.js').DelegationsBucket} delegationsStore
 */
async function addRevocationProofs(writer, delegationCID, revocations, delegationsStore) {
  // For each revocation, we need to add the revocation UCAN proof blocks
  for (const [, scopeRevocations] of Object.entries(revocations)) {
    for (const [, revocationData] of Object.entries(scopeRevocations)) {
      const revoked = /** @type {{ cause: import('multiformats/link').Link }} */ (revocationData)
      const revocationCID = CID.parse(revoked.cause.toString())
      
      try {
        // Get the revocation UCAN from delegations store
        const revocationBytes = await delegationsStore.get(revocationCID)
        if (revocationBytes) {
          writer.put({ cid: revocationCID, bytes: revocationBytes })
        }
      } catch (error) {
        console.warn(`Failed to fetch revocation proof ${revocationCID}:`, error)
      }
    }
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
