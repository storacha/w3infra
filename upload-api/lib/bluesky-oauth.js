import { NodeOAuthClient } from '@atproto/oauth-client-node'
import { JoseKey } from '@atproto/jwk-jose'
import { Config } from 'sst/node/config'

/**
 * @import { NodeOAuthClient as NodeOAuthClientType } from '@atproto/oauth-client-node'
 * @import { JWKSet } from '@atproto/jwk'
 */

/** @type {NodeOAuthClientType | null} */
let cachedClient = null

/**
 * Simple in-memory store implementations for development
 * In production, you might want to use Redis or DynamoDB
 * @implements {import('@atproto/oauth-client-node').StateStore}
 */
class MemoryStateStore {
  constructor() {
    /** @type {Map<string, any>} */
    this.states = new Map()
  }

  /**
   * @param {string} key
   * @returns {Promise<any | null>}
   */
  async get(key) {
    return this.states.get(key) || null
  }

  /**
   * @param {string} key
   * @param {any} internalState
   * @returns {Promise<void>}
   */
  async set(key, internalState) {
    this.states.set(key, internalState)
  }

  /**
   * @param {string} key
   * @returns {Promise<void>}
   */
  async del(key) {
    this.states.delete(key)
  }
}

/**
 * @implements {import('@atproto/oauth-client-node').SessionStore}
 */
class MemorySessionStore {
  constructor() {
    /** @type {Map<string, any>} */
    this.sessions = new Map()
  }

  /**
   * @param {string} key
   * @returns {Promise<any | null>}
   */
  async get(key) {
    return this.sessions.get(key) || null
  }

  /**
   * @param {string} key
   * @param {any} session
   * @returns {Promise<void>}
   */
  async set(key, session) {
    this.sessions.set(key, session)
  }

  /**
   * @param {string} key
   * @returns {Promise<void>}
   */
  async del(key) {
    this.sessions.delete(key)
  }
}

/**
 * Get or create the Bluesky OAuth client
 * @returns {Promise<NodeOAuthClientType>}
 */
export async function getBlueskyOAuthClient() {
  if (cachedClient) {
    return cachedClient
  }

  // Get the base URL for this service
  const baseUrl = process.env.UPLOAD_SERVICE_URL || 'https://up.web3.storage'

  // Create client metadata
  /** @type {import('@atproto/oauth-client-node').ClientMetadata} */
  const clientMetadata = {
    client_id: `${baseUrl}/.well-known/client-metadata.json`,
    client_name: 'Storacha Network',
    client_uri: 'https://storacha.network',
    logo_uri: 'https://w3s.link/ipfs/bafybeihinjwsn3kgjrlpdada4xingozsni3boywlscxspc5knatftauety/storacha-bug.svg',
    tos_uri: 'https://storacha.network/terms',
    policy_uri: 'https://storacha.network/privacy',
    redirect_uris: [`${baseUrl}/oauth/bluesky/callback`],
    response_types: ['code'],
    grant_types: ['authorization_code', 'refresh_token'],
    application_type: 'web',
    token_endpoint_auth_method: 'private_key_jwt',
    dpop_bound_access_tokens: true,
    jwks_uri: `${baseUrl}/.well-known/jwks.json`,
    scope: 'atproto transition:generic'
  }

  // Create JWK from the private key
  const privateKey = Config.BLUESKY_PRIVATE_KEY
  if (!privateKey) {
    throw new Error('BLUESKY_PRIVATE_KEY must be configured')
  }

  // Parse the private key (assuming it's base64url encoded like UCAN keys)
  /** @type {any} */
  let keyData

  // Decode as base64url (like UCAN keys)
  const { base64url } = await import('multiformats/bases/base64')
  keyData = base64url.decode(privateKey)

  const keyset = await Promise.all([
    JoseKey.fromImportable(keyData, 'bluesky-oauth-key')
  ])

  cachedClient = new NodeOAuthClient({
    clientMetadata,
    keyset,
    stateStore: new MemoryStateStore(),
    sessionStore: new MemorySessionStore()
  })

  return cachedClient
}

/**
 * Create authorization URL for Bluesky OAuth
 * @param {string} handle - Bluesky handle (e.g., 'user.bsky.social')
 * @param {object} [options] - Authorization options
 * @returns {Promise<{ url: string, state: string }>}
 */
export async function createAuthorizationUrl(handle, options = {}) {
  const client = await getBlueskyOAuthClient()

  const authUrl = await client.authorize(handle, {
    scope: 'atproto transition:generic',
    ...options
  })

  return authUrl
}

/**
 * Handle OAuth callback
 * @param {URLSearchParams} params - Callback parameters
 * @returns {Promise<{ session: import('@atproto/oauth-client-node').OAuthSession, profile: any }>}
 */
export async function handleCallback(params) {
  const client = await getBlueskyOAuthClient()

  const { session } = await client.callback(params)

  // Get user profile information
  const agent = session.agent
  /** @type {{ data: any }} */
  const profile = await agent.getProfile({ actor: session.did })

  return {
    session,
    profile: profile.data
  }
}