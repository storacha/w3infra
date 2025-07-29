import { DmailSSOService } from './dmail-service.js'
import { ok, error, Message, Receipt } from '@ucanto/core'
import * as Access from '@storacha/capabilities/access'
import * as DidMailto from '@storacha/did-mailto'
import { uploadServiceConnection } from '@storacha/client/service'
import * as Transport from '@ucanto/transport/car'
import * as Validator from '@ucanto/validator'
import { Verifier } from '@ucanto/principal'
import { AgentMessage } from '@web3-storage/upload-api'

/**
 * @typedef {import('@storacha/upload-api/types').SSOProvider} SSOProvider
 * @typedef {import('@storacha/upload-api/types').SSOService} SSOService
 * @typedef {import('@storacha/upload-api/types').SSOAuthParams} SSOAuthParams
 * @typedef {import('@storacha/upload-api/types').SSOAuthResponse} SSOAuthResponse
 */

/**
 * Multi-provider SSO Router
 *
 * Routes SSO validation requests to the appropriate provider-specific service
 * 
 * @implements {SSOService}
 */
export class SSORouter {
  /**
   *
   * @param {import('@ucanto/interface').Signer} serviceSigner - The service signer
   * @param {import('@storacha/upload-api').AgentStore} agentStore - The agent store
   * @param {Record<string, SSOProvider>} providers - Map of provider name to service instance
   */
  constructor(serviceSigner, agentStore, providers = {}) {
    this.serviceSigner = serviceSigner
    this.agentStore = agentStore
    this.providers = providers
  }

  /**
   * Add a provider service
   *
   * @param {string} name - Provider name (e.g., 'dmail', 'discord')
   * @param {SSOProvider} service - Provider service instance with validate method
   */
  addProvider(name, service) {
    this.providers[name] = service
  }

  /**
   * Validate SSO request by routing to appropriate provider
   *
   * @param {SSOAuthParams} ssoAuthParams
   * @returns {Promise<import('@ucanto/server').Result<import('@ucanto/interface').Link, Error>>}
   */
  async authorize(ssoAuthParams) {
    const { authProvider } = ssoAuthParams
    if (!authProvider) {
      return error(new Error('Missing authProvider in SSO request'))
    }

    const provider = this.providers[authProvider]
    if (!provider) {
      return error(new Error(`Unsupported SSO provider: ${authProvider}`))
    }

    const invocation = /** @type {import('@ucanto/interface').Invocation<import('@storacha/upload-api').AccessAuthorize>} */(ssoAuthParams.invocation)
    const accessRes = await Validator.access(invocation, {
      capability: Access.authorize,
      authority: this.serviceSigner,
      principal: Verifier,
      validateAuthorization: () => ok({})
    })
    if (accessRes.error) {
      console.error('validating access/authorize delegation', accessRes.error)
      return error(new Error('failed to validate access/authorize delegation for SSO provider ' + authProvider))
    }
    const capability = invocation.capabilities[0] ?? undefined
    if (!capability) {
      return error(new Error('missing capability in the access/authorize invocation'))
    }

    // Step 1: Validate with SSO provider
    const result = await provider.validate(ssoAuthParams)
    if (result.error) {
      return result
    }
    
    const lifetimeInSeconds = 60 * 15
    const message = await Message.build({
      invocations: [ssoAuthParams.invocation],
      receipts: [
        await Receipt.issue({
          issuer: this.serviceSigner,
          ran: ssoAuthParams.invocation,
          result: ok({
            expiration: Math.floor(Date.now() / 1000) + lifetimeInSeconds,
            request: ssoAuthParams.invocation.cid
          })
        })
      ]
    })
    const messageWriteRes = await this.agentStore.messages.write({
      source: await Transport.outbound.encode(message),
      data: message,
      index: AgentMessage.index(message)
    })

    if (messageWriteRes.error) {
      console.error(messageWriteRes.error)
      return error(new Error('failed to write access/authorize invocation and receipt for SSO provider ' + authProvider))
    }
    const customer = DidMailto.fromEmail(/** @type {`${string}@${string}`} */(result.ok.userData.email))
        
    const confirmRes = await Access.confirm
      .invoke({
        issuer: this.serviceSigner,
        audience: this.serviceSigner,
        with: this.serviceSigner.did(),
        lifetimeInSeconds,
        nb: {
          iss: customer,
          att: capability.nb.att,
          aud: capability.with,
          // Link to the invocation that requested the SSO authorization.
          cause: ssoAuthParams.invocation.cid,
        },
      })
      .execute(uploadServiceConnection())

    if (confirmRes.out.error) {
      console.error('executing access/confirm', confirmRes.out.error)
      return error(new Error('failed to execute access/confirm invocation for SSO provider ' + authProvider))
    }

    // Note: here we can add the customer to the customer store here with a trial plan to eliminate the need of the plan selection step
    
    // Step 3: Return the link to the confirmed authorization
    return ok(confirmRes.link())
  }

  /**
   * Get list of available providers
   *
   * @returns {string[]}
   */
  getAvailableProviders() {
    return Object.keys(this.providers)
  }
}

/**
 * Create SSO service with configured providers
 *
 * @param {import('@ucanto/interface').Signer} serviceSigner - The service signer
 * @param {import('@storacha/upload-api').AgentStore} agentStore - The agent store
 * @param {Array<SSOProvider & {name: string}>} providers - Array of SSO provider services with name property
 * @returns {SSORouter}
 */
export function createSSOService(serviceSigner, agentStore, providers) {
  if (!providers || providers.length === 0 || !providers.every(provider => provider && provider.name)) {
    throw new Error('SSO service requires at least one provider with a name')
  }

  const router = new SSORouter(serviceSigner, agentStore)
  for (const provider of providers) {
    router.addProvider(provider.name, provider)
  }

  return router
}

/**
 * Create DMAIL SSO service from environment variables
 * 
 * @param {Record<string, string>} env - Environment variables
 * @returns {DmailSSOService}
 */
export function createDmailSSOService(env) {
  return new DmailSSOService({
      apiKey: env.DMAIL_API_KEY,
      apiSecret: env.DMAIL_API_SECRET,
      jwtSecret: env.DMAIL_JWT_SECRET,
      apiUrl: env.DMAIL_API_URL
    })
}