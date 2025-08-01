import crypto from 'crypto'
import pRetry from 'p-retry'
import { ok, error } from '@ucanto/core'

/**
 * @typedef {object} User
 * @property {string} id
 * @property {string} email
 * @property {boolean} emailVerified
 * @property {string} accountStatus
 * @property {string} createdAt
 * 
 * @typedef {object} APIResponse
 * @property {boolean} success
 * @property {number} code
 * @property {string} message
 * @property {User} user?
 * @property {number} retryAfter?
 */

/**
 * @typedef {import('@storacha/upload-api/types').SSOProvider} SSOProvider
 * @typedef {import('@storacha/upload-api/types').SSOAuthParams} SSOAuthParams
 * @typedef {import('@storacha/upload-api/types').SSOAuthResponse} SSOAuthResponse
 */

/**
 * DMAIL SSO Service Implementation
 * 
 * Provides JWT verification + API validation for DMAIL users
 * Based on the validation logic from ../storacha/dmail-user-verification
 * 
 * @implements {SSOProvider}
 */
export class DmailSSOService {
  /**
   * @param {object} config
   * @param {string} config.apiKey - DMAIL API key
   * @param {string} config.apiSecret - DMAIL API secret for HMAC signing  
   * @param {string} config.jwtSecret - DMAIL JWT shared secret for verification
   * @param {string} config.apiUrl - DMAIL API base URL
   */
  constructor(config) {
    this.name = 'dmail'
    this.apiKey = config.apiKey
    this.apiSecret = config.apiSecret
    this.jwtSecret = config.jwtSecret
    this.apiUrl = config.apiUrl

    if (!this.apiKey || !this.apiSecret) {
      throw new Error('DMAIL API key and secret are required')
    }

    if (!this.apiUrl) {
      throw new Error('DMAIL API base URL is required')
    }

    if (!this.jwtSecret) {
      throw new Error('DMAIL JWT shared secret is required for token verification')
    }
  }

  /**
   * Validate SSO request with JWT + API validation
   * Implements the SSOProvider interface expected by upload-service
   * 
   * @param {SSOAuthParams} ssoAuthParams
   * @returns {Promise<import('@ucanto/server').Result<SSOAuthResponse, Error>>}
   */
  async validate(ssoAuthParams) {
    const { authProvider, email, externalUserId, externalSessionToken } = ssoAuthParams
    if (authProvider !== 'dmail') {
      return error(new Error('Invalid auth provider for DMAIL service'))
    }

    try {
      // Step 1: Verify JWT token (cryptographic proof)
      if (externalSessionToken && externalSessionToken !== 'unused') {
        await this.verifyJWT(externalSessionToken, email, externalUserId)
      }

      // Step 2: Validate user with DMAIL API (real-time status)
      const apiResult = await this.validateWithAPI(email, externalUserId)
      if (apiResult.error) {
        return error(new Error(`DMAIL API validation failed: ${apiResult.error.message}`, { cause: apiResult.error }))
      }

      return ok(apiResult.ok)

    } catch (err) {
      return error(new Error(`DMAIL validation failed: ${err instanceof Error ? err.message : String(err)}`))
    }
  }

  /**
   * Verify JWT token signature and claims
   *
   * @param {string} token - JWT token to verify
   * @param {string} expectedEmail - Expected email claim
   * @param {string} expectedUserId - Expected userId claim
   * @returns {Promise<object>} Verified JWT claims
   */
  async verifyJWT(token, expectedEmail, expectedUserId) {
    try {
      // Parse JWT without verification first to get header/payload
      const parts = token.split('.')
      if (parts.length !== 3) {
        throw new Error('Invalid JWT format')
      }

      const [headerB64, payloadB64, signatureB64] = parts

      // Decode header and payload
      const header = JSON.parse(Buffer.from(headerB64, 'base64url').toString())
      const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString())

      // 1. Verify algorithm
      if (header.alg !== 'HS256') {
        throw new Error(`Unsupported JWT algorithm: ${header.alg}`)
      }

      // 2. Verify signature
      const expectedSignature = crypto
        .createHmac('sha256', this.jwtSecret)
        .update(`${headerB64}.${payloadB64}`)
        .digest('base64url')

      if (!crypto.timingSafeEqual(
        Buffer.from(signatureB64, 'base64url'),
        Buffer.from(expectedSignature, 'base64url')
      )) {
        throw new Error('Invalid JWT signature')
      }

      // 3. Verify standard claims
      const now = Math.floor(Date.now() / 1000)

      if (payload.exp && payload.exp < now) {
        throw new Error('JWT token expired')
      }

      if (payload.nbf && payload.nbf > now) {
        throw new Error('JWT token not yet valid')
      }

      if (payload.iss !== 'dmail.ai') {
        throw new Error(`Invalid issuer: ${payload.iss}`)
      }

      if (payload.aud !== 'storacha.network') {
        throw new Error(`Invalid audience: ${payload.aud}`)
      }

      // 4. Verify custom claims match request
      if (payload.email !== expectedEmail) {
        throw new Error('JWT email claim does not match request email')
      }

      if (payload.userId !== expectedUserId) {
        throw new Error('JWT userId claim does not match request userId')
      }

      return payload
    } catch (error) {
      throw new Error(`JWT verification failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /**
   * Validate user with DMAIL API (real-time status check)
   *
   * @param {string} email - User email
   * @param {string} externalUserId - External user ID
   * @returns {Promise<import('@ucanto/server').Result<SSOAuthResponse, Error>>} API validation result
   */
  async validateWithAPI(email, externalUserId) {
    const payload = { email, userId: externalUserId }
    const headers = this.generateHMACSignature(this.apiKey, this.apiSecret, payload)

    try {
      /** @type {APIResponse} */
      let responseData = await this.makeAPIRequest(payload, headers)
      
      // Handle 429 rate limiting with retryAfter
      if (!responseData.success && responseData.code === 429) {
        const retryAfter = responseData.retryAfter || 2 // Default to 2 seconds if not provided
        console.warn(`DMAIL API rate limited, waiting ${retryAfter} seconds before retry`)
        
        // Wait for the specified time, but cap it at 5 seconds because we don't want to wait too long for login scenarios
        const waitTime = Math.min(retryAfter * 1000, 5000)
        await new Promise(resolve => setTimeout(resolve, waitTime))
        
        // Retry once after rate limit delay
        responseData = await this.makeAPIRequest(payload, headers)
        
        // If still rate limited, give up
        if (!responseData.success && responseData.code === 429) {
          return error(new Error(`DMAIL API rate limit exceeded: ${responseData.retryAfter} seconds`))
        }
      }

      const { success, user } = responseData
      if (!success) {
        return error(new Error(responseData.message || 'DMAIL user validation failed'))
      }

      if (!user) {
        return error(new Error('DMAIL user validation failed due to missing user data'))
      }

      if (!user.emailVerified) {
        return error(new Error('DMAIL user validation failed due to unverified email'))
      }
      
      return ok({
        userData: {
          id: user.id,
          email: user.email,
          accountStatus: user.accountStatus
        }
      })

    } catch (err) {
      return error(new Error(`DMAIL API request failed: ${err instanceof Error ? err.message : String(err)}`))
    }
  }

  /**
   * Make a single API request with retry logic for server errors only
   * 
   * @param {object} payload - Request payload
   * @param {Record<string, string>} headers - Request headers
   * @returns {Promise<APIResponse>} API response data 
   */
  async makeAPIRequest(payload, headers) {
    return await pRetry(async () => {
      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload)
      })

      if (!response.ok) {
        // HTTP-level errors (network issues, etc.) - always retry
        throw new Error(`DMAIL API HTTP error: ${response.status}`)
      }

      /** @type {APIResponse} */
      const data = await response.json()
      
      // Check DMAIL API response codes for retryable errors
      if (!data.success) {
        if (data.code === 500) {
          // Only retry server errors (500) - let 429 be handled by caller
          throw new Error(`DMAIL API server error: ${data.code} - ${data.message}`)
        } else {
          // Client errors (401, 403, 404) and rate limits (429) are not retryable here
          const err = new Error(`DMAIL API error: ${data.code} - ${data.message}`)
          err.name = 'AbortError' // This stops p-retry from retrying
          throw err
        }
      }

      return data
    }, {
      retries: 2, // Total of 3 attempts for 500 errors only (1 initial + 2 retries)
      minTimeout: 500, // Start with 500ms delay
      maxTimeout: 2000, // Cap at 2 seconds
      factor: 1.5, // exponential backoff
      onFailedAttempt: (error) => {
        console.warn(`DMAIL API attempt ${error.attemptNumber} failed: ${error.message}`)
      }
    })
  }

  /**
   * Generate HMAC signature for DMAIL API authentication
   * 
   * @param {string} apiKey - DMAIL API key
   * @param {string} apiSecret - DMAIL API secret for HMAC signing
   * @param {object} payload - Request payload
   * @returns {Record<string, string>} Headers with authentication and signature
   */
  generateHMACSignature(apiKey, apiSecret, payload) {
    const timestamp = Math.floor(Date.now() / 1000)
    const payloadString = JSON.stringify(payload)
    const signaturePayload = `${apiKey}.${timestamp}.${payloadString}`
    const signature = crypto
      .createHmac('sha256', apiSecret)
      .update(signaturePayload)
      .digest('hex')

    return {
      'Authorization': `Bearer ${apiKey}`,
      'X-Signature': `sha256=${signature}`,
      'X-Timestamp': timestamp.toString(),
      'Content-Type': 'application/json',
    }
  }
  
}