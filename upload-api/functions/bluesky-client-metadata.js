import { getBlueskyOAuthClient } from '../lib/bluesky-oauth.js'

/**
 * AWS HTTP Gateway handler for GET /.well-known/client-metadata.json
 * This endpoint provides OAuth client metadata required by Bluesky's AT Protocol
 *
 * @param {import('aws-lambda').APIGatewayProxyEventV2} request
 * @returns {Promise<import('aws-lambda').APIGatewayProxyResultV2>}
 */
export const blueskyClientMetadataGet = async (request) => {
  try {
    const client = await getBlueskyOAuthClient()
    
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        // no caching for now, but we should configure this later 'Cache-Control': 'public, max-age=3600' // Cache for 1 hour
      },
      body: JSON.stringify(client.clientMetadata, null, 2)
    }
  } catch (error) {
    console.error('Failed to get client metadata:', error)
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Internal server error' })
    }
  }
}

export const handler = blueskyClientMetadataGet