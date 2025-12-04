import { Config } from 'sst/node/config'
import * as Sentry from '@sentry/serverless'
import { base64url } from 'multiformats/bases/base64'
import { Message, Delegation, Receipt, ok, error } from '@ucanto/core'
import * as Transport from '@ucanto/transport/car'
import * as Validator from '@ucanto/validator'
import { Verifier } from '@ucanto/principal'
import { AgentMessage } from '@storacha/upload-api'
import * as Access from '@storacha/capabilities/access'
import * as DidMailto from '@storacha/did-mailto'
import { mustGetEnv } from '../../lib/env.js'
import { open as openAgentStore } from '../stores/agent.js'
import { createCustomerStore } from '../../billing/tables/customer.js'
import { getServiceSigner, getServiceConnection } from '../config.js'
import { wrapLambdaHandler } from '../otel.js'

/**
 * @import { Endpoints } from '@octokit/types'
 * @import { Signer, Result, ConnectionView } from '@ucanto/interface'
 * @import { AgentStore, Service } from '@storacha/upload-api'
 * @typedef {{
 *   getOAuthAccessToken: (params: { code: string }) => Promise<Result<{ access_token: string }>>
 *   getUser: (params: { accessToken: string }) => Promise<Result<Endpoints['GET /user']['response']['data']>>
 *   getUserEmails: (params: { accessToken: string }) => Promise<Result<Endpoints['GET /user/emails']['response']['data']>>
 * }} GitHub
 * @typedef {{
 *   serviceSigner: Signer
 *   agentStore: AgentStore
 *   github: GitHub
 *   customerStore: import('../../billing/lib/api.js').CustomerStore
 *   getServiceConnection: () => ConnectionView<Service>
 * }} Context
 */

Sentry.AWSLambda.init({
  environment: process.env.SST_STAGE,
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 0,
})

/** The minimum age a GitHub account must be to allow trial plan enrollment. */
const MIN_ACCOUNT_AGE = 24 * 60 * 60 * 1000

/**
 * AWS HTTP Gateway handler for GET /oauth/callback.
 *
 * @param {import('aws-lambda').APIGatewayProxyEventV2} request
 * @param {import('aws-lambda').Context} [context]
 */
export const oauthCallbackGet = async (request, context) => {
  const {
    serviceSigner,
    agentStore,
    github,
    customerStore,
    getServiceConnection
  } = getContext(context?.clientContext?.Custom)

  const code = request.queryStringParameters?.code
  if (!code) {
    console.error('missing code in query params')
    return { statusCode: 400, body: 'missing code in query params' }
  }

  const extractRes = await Delegation.extract(base64url.decode(request.queryStringParameters?.state ?? ''))
  if (extractRes.error) {
    console.error('decoding access/authorize delegation', extractRes.error)
    return { statusCode: 400, body: 'failed to decode access/authorize delegation' }
  }

  const authRequest =
    /** @type {import('@ucanto/interface').Invocation<import('@storacha/upload-api').AccessAuthorize>} */
    (extractRes.ok)

  const accessRes = await Validator.access(authRequest, {
    capability: Access.authorize,
    authority: serviceSigner,
    principal: Verifier,
    validateAuthorization: () => ok({})
  })
  if (accessRes.error) {
    console.error('validating access/authorize delegation', accessRes.error)
    return { statusCode: 400, body: 'failed to validate access/authorize delegation' }
  }

  const accessTokenRes = await github.getOAuthAccessToken({ code })
  if (!accessTokenRes.ok) {
    console.error(accessTokenRes.error)
    return { statusCode: 400, body: 'failed to get OAuth access token' }
  }
  const accessToken = accessTokenRes.ok.access_token

  const [userRes, userEmailsRes] = await Promise.all([
    github.getUser({ accessToken }),
    github.getUserEmails({ accessToken })
  ])
  if (!userRes.ok) {
    console.error(userRes.error)
    return { statusCode: 500, body: 'failed to get user profile' }
  }
  if (!userEmailsRes.ok) {
    console.error(userEmailsRes.error)
    return { statusCode: 500, body: 'failed to get user emails' }
  }

  const user = userRes.ok
  const emails = userEmailsRes.ok
  const primary = emails.find(e => e.primary && e.verified)
  if (!primary) {
    console.error('missing primary verified email', emails)
    return { statusCode: 400, body: 'missing primary verified email' }
  }

  // record the auth request and issue a receipt
  const lifetimeInSeconds = 60 * 15
  const message = await Message.build({
    invocations: [authRequest],
    receipts: [
      await Receipt.issue({
        issuer: serviceSigner,
        ran: authRequest,
        result: ok({
          expiration: Math.floor(Date.now() / 1000) + lifetimeInSeconds,
          request: authRequest.cid
        })
      })
    ]
  })
  const messageWriteRes = await agentStore.messages.write({
    source: await Transport.outbound.encode(message),
    data: message,
    index: AgentMessage.index(message)
  })
  if (messageWriteRes.error) {
    console.error(messageWriteRes.error)
    return { statusCode: 500, body: 'failed to write access/authorize invocation and receipt' }
  }

  const customer = DidMailto.fromEmail(/** @type {`${string}@${string}`} */ (primary.email))
  const confirmRes = await Access.confirm
    .invoke({
      issuer: serviceSigner,
      // audience same as issuer because this is a service invocation
      audience: serviceSigner,
      // Because with is set to our DID no other actor will be able to issue
      // this delegation without our private key.
      with: serviceSigner.did(),
      lifetimeInSeconds,
      // We link to the authorization request so that this attestation can
      // not be used to authorize a different request.
      nb: {
        // we copy request details and set the `aud` field to the agent DID
        // that requested the authorization.
        iss: customer,
        att: authRequest.capabilities[0].nb.att,
        aud: authRequest.capabilities[0].with,
        // Link to the invocation that requested the authorization.
        cause: authRequest.cid,
      },
    })
    .execute(getServiceConnection())

  if (!confirmRes.out.ok) {
    console.error('executing access/confirm', confirmRes.out.error)
    return { statusCode: 500, body: 'failed to execute access/confirm invocation' }
  }

  const customerGetRes = await customerStore.get({ customer })
  if (customerGetRes.ok) {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'text/html' },
      body: Buffer.from(getResponseHTML()).toString('base64'),
      isBase64Encoded: true,
    }
  }
  if (customerGetRes.error.name !== 'RecordNotFound') {
    console.error(`getting customer: ${customer}`, customerGetRes.error)
    return { statusCode: 500, body: 'failed to fetch customer record' }
  }
  if (new Date(user.created_at).getTime() > Date.now() - MIN_ACCOUNT_AGE) {
    console.error(`account too young: ${user.login}`)
    return { statusCode: 400, body: 'account too young' }
  }

  // add a customer with a trial product
  const customerPutRes = await customerStore.put({
    customer,
    product: 'did:web:trial.storacha.network',
    details: JSON.stringify({ github: { id: user.id, login: user.login } }),
    insertedAt: new Date()
  })
  if (!customerPutRes.ok) {
    console.error(`putting customer: ${customer}`, customerPutRes.error)
    return { statusCode: 500, body: 'failed to put customer' }
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'text/html' },
    body: Buffer.from(getResponseHTML()).toString('base64'),
    isBase64Encoded: true,
  }
}

export const handler = Sentry.AWSLambda.wrapHandler(
  wrapLambdaHandler('oauth-callback', (event) => oauthCallbackGet(event))
)

/**
 * @param {Context} [customContext]
 * @returns {Context}
 */
const getContext = (customContext) => {
  if (customContext) return customContext

  const region = process.env.AWS_REGION || 'us-west-2'

  const serviceSigner = getServiceSigner({
    did: process.env.UPLOAD_API_DID,
    privateKey: Config.PRIVATE_KEY
  })

  const agentStore = openAgentStore({
    store: {
      connection: { address: { region } },
      region,
      buckets: {
        message: { name: mustGetEnv('AGENT_MESSAGE_BUCKET_NAME') },
        index: { name: mustGetEnv('AGENT_INDEX_BUCKET_NAME') },
      },
    },
    stream: {
      connection: { address: { region } },
      name: mustGetEnv('UCAN_LOG_STREAM_NAME'),
    },
  })

  const github = new GitHubClient({
    clientID: mustGetEnv('GITHUB_CLIENT_ID'),
    clientSecret: Config.GITHUB_CLIENT_SECRET
  })

  const customerStore = createCustomerStore({ region }, { tableName: mustGetEnv('CUSTOMER_TABLE_NAME') })

  return {
    serviceSigner,
    agentStore,
    github,
    customerStore,
    getServiceConnection: () => getServiceConnection({
      did: serviceSigner.did(),
      url: mustGetEnv('UPLOAD_SERVICE_URL')
    })
  }
}

class GitHubClient {
  #clientID
  #clientSecret

  /** @param {{ clientID: string, clientSecret: string }} config */
  constructor ({ clientID, clientSecret }) {
    this.#clientID = clientID
    this.#clientSecret = clientSecret
  }

  /** @type {GitHub['getOAuthAccessToken']} */
  async getOAuthAccessToken({ code }) {
    const params = new FormData()
    params.set('client_id', this.#clientID)
    params.set('client_secret', this.#clientSecret)
    params.set('code', code)
  
    try {
      const accessTokenRes = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: { Accept: 'application/json' },
        body: params
      })
      if (!accessTokenRes.ok) {
        return error(new Error(`fetching access token: ${accessTokenRes.status}`))
      }
      return ok(/** @type {{ access_token: string }} */ (await accessTokenRes.json()))
    } catch (/** @type {any} */ err) {
      return error(err)
    }
  }

  /** @type {GitHub['getUser']} */
  async getUser ({ accessToken }) {
    try {
      const userRes = await fetch('https://api.github.com/user', {
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${accessToken}`,
          'X-GitHub-Api-Version': '2022-11-28'
        }
      })
      if (!userRes.ok) {
        return error(new Error(`fetching user profile: ${userRes.status}`))
      }
      /** @type {import('@octokit/types').Endpoints['GET /user']['response']['data']} */
      const profile = await userRes.json()
      return ok(profile)
    } catch (/** @type {any} */ err) {
      return error(err)
    }
  }

  /** @type {GitHub['getUserEmails']} */
  async getUserEmails ({ accessToken }) {
    try {
      const userEmailsRes = await fetch('https://api.github.com/user/emails', {
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${accessToken}`,
          'X-GitHub-Api-Version': '2022-11-28'
        }
      })
      if (!userEmailsRes.ok) {
        return error(new Error(`fetching user emails: ${userEmailsRes.status}`))
      }
      /** @type {import('@octokit/types').Endpoints['GET /user/emails']['response']['data']} */
      const emails = await userEmailsRes.json()
      return ok(emails)
    } catch (/** @type {any} */ err) {
      return error(err)
    }
  }
}

const getResponseHTML = () => `
<!doctype html>
<html lang="en">
  <head>
    <title>Authorized - Storacha Network</title>
  </head>
  <body style="font-family:sans-serif;color:#000">
    <div style="height:100vh;display:flex;align-items:center;justify-content:center">
      <div style="text-align:center">
        <img src="https://w3s.link/ipfs/bafybeihinjwsn3kgjrlpdada4xingozsni3boywlscxspc5knatftauety/storacha-bug.svg" alt="Storacha - Decentralized Hot Storage Layer on Filecoin">
        <h1 style="font-weight:normal">Authorization Successful</h1>
        <p>You may now close this window.</p>
      </div>
    </div>
  </body>
</html>
`.trim()
