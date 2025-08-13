import * as Sentry from '@sentry/serverless'
import { createRevocationsTable } from '../stores/revocations.js'
import { mustGetEnv } from '../../lib/env.js'
import * as Link from 'multiformats/link'

Sentry.AWSLambda.init({
  environment: process.env.SST_STAGE,
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 0,
})

/**
 * AWS HTTP Gateway handler for POST /revocations/check
 * 
 * Accepts an array of delegation CIDs and returns relevant revocations.
 * Request body:
 * - cids: array of delegation CID strings to check for revocations
 * 
 * @param {import('aws-lambda').APIGatewayProxyEventV2} request
 */
export async function revocationsCheck(request) {
  try {
    // Parse delegation CIDs from request body
    let requestBody
    try {
      requestBody = JSON.parse(request.body || '{}')
    } catch {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          error: 'Invalid JSON',
          message: 'Request body must be valid JSON'
        }),
      }
    }

    const { cids } = requestBody
    if (!cids) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          error: 'Missing required field: cids',
          message: 'Please provide delegation CIDs as an array in the "cids" field'
        }),
      }
    }

    // Validate CIDs array
    if (!Array.isArray(cids)) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          error: 'Invalid field type: cids',
          message: 'The "cids" field must be an array of strings'
        }),
      }
    }
    if (cids.length === 0) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          error: 'Invalid parameter: cids',
          message: 'At least one delegation CID must be provided'
        }),
      }
    }

    if (cids.length > 100) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          error: 'Too many CIDs',
          message: 'Maximum 100 delegation CIDs can be checked in a single request'
        }),
      }
    }

    const revocationTableName = mustGetEnv('REVOCATION_TABLE_NAME')
    const awsRegion = process.env.AWS_REGION || 'us-west-2'
    const dbEndpoint = process.env.DYNAMO_DB_ENDPOINT
    const revocationsStorage = createRevocationsTable(awsRegion, revocationTableName, {
      endpoint: dbEndpoint
    })

    // Build query object - RevocationsStorage.query expects an object with CID keys
    /** @type {Record<string, any>} */
    const query = {}
    for (const cid of cids) {
      try {
        const parsedCID = Link.parse(cid)
        const normalizedCID = parsedCID.toString()
        query[normalizedCID] = true // The value doesn't matter, just the key
      } catch {
        return {
          statusCode: 400,
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            error: 'Invalid CID format',
            message: `Invalid CID provided: ${cid}. Please ensure all CIDs are valid IPFS CID strings.`
          }),
        }
      }
    }

    // Query for revocations
    const result = await revocationsStorage.query(query)
    
    if (!result.ok) {
      console.error('Failed to query revocations:', result.error)
      return {
        statusCode: 500,
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          error: 'Internal server error',
          message: 'Failed to query revocations'
        }),
      }
    }

    // Return the revocations
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*', // Allow CORS for public endpoint
        'Access-Control-Allow-Methods': 'POST',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
      body: JSON.stringify({
        revocations: result.ok
      }),
    }

  } catch (error) {
    console.error('Error in revocations endpoint:', error)
    Sentry.captureException(error)
    
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        error: 'Internal server error',
        message: 'An unexpected error occurred'
      }),
    }
  }
}

export const handler = Sentry.AWSLambda.wrapHandler(revocationsCheck)
