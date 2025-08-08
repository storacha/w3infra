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
import { handleCallback } from '../lib/bluesky-oauth.js'

/**
 * @import { Signer, ConnectionView } from '@ucanto/interface'
 * @import { AgentStore, Service } from '@storacha/upload-api'
 * @typedef {{
 *   serviceSigner: Signer
 *   agentStore: AgentStore
 *   customerStore: import('../../billing/lib/api.js').CustomerStore
 *   getServiceConnection: () => ConnectionView<Service>
 * }} Context
 */

Sentry.AWSLambda.init({
  environment: process.env.SST_STAGE,
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 0,
})

/** The minimum age a Bluesky account must be to allow trial plan enrollment. */
const MIN_ACCOUNT_AGE = 24 * 60 * 60 * 1000

/**
 * AWS HTTP Gateway handler for GET /oauth/bluesky/callback.
 *
 * @param {import('aws-lambda').APIGatewayProxyEventV2} request
 * @param {import('aws-lambda').Context} [context]
 * @returns {Promise<import('aws-lambda').APIGatewayProxyResultV2>}
 */
export const oauthBlueskyCallbackGet = async (request, context) => {
  const {
    serviceSigner,
    agentStore,
    customerStore,
    getServiceConnection
  } = getContext(context?.clientContext?.Custom)

  // Extract OAuth callback parameters
  const searchParams = new URLSearchParams()
  for (const [key, value] of Object.entries(request.queryStringParameters || {})) {
    if (value) {
      searchParams.set(key, value)
    }
  }

  try {
    // Handle the OAuth callback using @atproto/oauth-client-node
    const { session, profile } = await handleCallback(searchParams)

    /** @type {{ did: string, handle: string, email?: string, createdAt: string }} */
    const user = {
      did: session.did,
      handle: profile.handle,
      email: profile.email,
      createdAt: profile.createdAt || new Date().toISOString()
    }

    if (!user.email) {
      console.error('missing email in user profile', user)
      return { statusCode: 400, body: 'missing email in user profile' }
    }

    // The state should contain the original access/authorize delegation
    const state = searchParams.get('state')
    if (!state) {
      console.error('missing state in query params')
      return { statusCode: 400, body: 'missing state in query params' }
    }

    // Decode the delegation from state
    const extractRes = await Delegation.extract(base64url.decode(state))
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

    const customer = DidMailto.fromEmail(/** @type {`${string}@${string}`} */(user.email))
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
    if (new Date(user.createdAt).getTime() > Date.now() - MIN_ACCOUNT_AGE) {
      console.error(`account too young: ${user.handle}`)
      return { statusCode: 400, body: 'account too young' }
    }

    // add a customer with a trial product
    const customerPutRes = await customerStore.put({
      customer,
      product: 'did:web:trial.storacha.network',
      details: JSON.stringify({ bluesky: { did: user.did, handle: user.handle } }),
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
  } catch (error) {
    console.error('OAuth callback error:', error)
    return { statusCode: 500, body: 'OAuth callback failed' }
  }
}

export const handler = Sentry.AWSLambda.wrapHandler((event) => oauthBlueskyCallbackGet(event))

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

  const customerStore = createCustomerStore({ region }, { tableName: mustGetEnv('CUSTOMER_TABLE_NAME') })

  return {
    serviceSigner,
    agentStore,
    customerStore,
    getServiceConnection: () => getServiceConnection({
      did: serviceSigner.did(),
      url: mustGetEnv('UPLOAD_SERVICE_URL')
    })
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