import { Config } from 'sst/node/config'
import * as Sentry from '@sentry/serverless'
import { base64url } from 'multiformats/bases/base64'
import { Delegation, ok } from '@ucanto/core'
import * as Validator from '@ucanto/validator'
import { Verifier } from '@ucanto/principal'
import * as Access from '@storacha/capabilities/access'
import * as DidMailto from '@storacha/did-mailto'
import { mustGetEnv } from '../../lib/env.js'
import { createCustomerStore } from '../../billing/tables/customer.js'
import { getServiceSigner } from '../config.js'
import { jwtDecode } from "jwt-decode"
import { createHumanodesTable } from '../stores/humanodes.js'
import { wrapLambdaHandler } from '../otel.js'


/**
 * @import { Endpoints } from '@octokit/types'
 * @import { Signer, Result } from '@ucanto/interface'
 * @typedef {{
 *   getOAuthAccessToken: (params: { code: string }) => Promise<Result<{ access_token: string }>>
 *   getUser: (params: { accessToken: string }) => Promise<Result<Endpoints['GET /user']['response']['data']>>
 *   getUserEmails: (params: { accessToken: string }) => Promise<Result<Endpoints['GET /user/emails']['response']['data']>>
 * }} GitHub
 * @typedef {{
 *   serviceSigner: Signer
 *   customerStore: import('../../billing/lib/api.js').CustomerStore
 *   humanodeStore: import('../types.js').HumanodeStore
 * }} Context
 */

Sentry.AWSLambda.init({
  environment: process.env.SST_STAGE,
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 0,
})

const HUMANODE_TOKEN_ENDPOINT = mustGetEnv('HUMANODE_TOKEN_ENDPOINT')
const HUMANODE_CLIENT_ID = mustGetEnv('HUMANODE_CLIENT_ID')
const HUMANODE_CLIENT_SECRET = Config.HUMANODE_CLIENT_SECRET

/**
 * AWS HTTP Gateway handler for GET /oauth/humanode/callback.
 *
 * @param {import('aws-lambda').APIGatewayProxyEventV2} request
 * @param {import('aws-lambda').Context} [context]
 */
export const oauthCallbackGet = async (request, context) => {
  const {
    serviceSigner,
    customerStore,
    humanodeStore
  } = getContext(context?.clientContext?.Custom)

  const code = request.queryStringParameters?.code
  if (!code) {
    console.error('missing code in query params')
    return htmlResponse(400, getUnexpectedErrorResponseHTML('Query params are missing code'))
  }

  // fetch the auth token from Humanode
  const tokenResponse = await fetch(HUMANODE_TOKEN_ENDPOINT, {
    method: 'POST', body: new URLSearchParams(
      {
        client_id: HUMANODE_CLIENT_ID,
        client_secret: HUMANODE_CLIENT_SECRET,
        grant_type: "authorization_code",
        code,
        redirect_uri: `https://${request.headers.host}${request.rawPath}`
      }
    )
  })
  const tokenResult = await tokenResponse.json()
  if (!tokenResult.id_token) {
    console.error(`Error getting token from ${HUMANODE_TOKEN_ENDPOINT} - got: ${JSON.stringify(tokenResult)}`)
    return htmlResponse(500, getUnexpectedErrorResponseHTML('Error communicating with Humanode'))
  }
  const humanodeIdToken = jwtDecode(tokenResult.id_token)
  const humanodeId = humanodeIdToken.sub
  if (!humanodeId) {
    console.error("humanodeId is undefined, this is very strange")
    return htmlResponse(500, getUnexpectedErrorResponseHTML('Failed to get Humanode ID'))
  }

  const existsResponse = await humanodeStore.exists(humanodeId)
  if (existsResponse.error){
    return htmlResponse(500, getUnexpectedErrorResponseHTML(existsResponse.error.message))
  }
  if (existsResponse.ok){
    return htmlResponse(400, getDuplicateHumanodeResponseHTML())
  }

  // validate the access/authorize delegation and pull the customer email out of it
  const extractRes = await Delegation.extract(base64url.decode(request.queryStringParameters?.state ?? ''))
  if (extractRes.error) {
    console.error('decoding access/authorize delegation', extractRes.error)
    return htmlResponse(400, getUnexpectedErrorResponseHTML('Failed to decode access/authorization delegation.'))
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

    return htmlResponse(400, getUnexpectedErrorResponseHTML('Failed to validate access/authorization delegation.'))
  }

  if (!accessRes.ok.capability.nb.iss) {
    return htmlResponse(400, getUnexpectedErrorResponseHTML('Account DID not included in authorize request.'))
  }

  let customer
  try {
    customer = DidMailto.fromString(accessRes.ok.capability.nb.iss)
  } catch (e) {
    console.error("error parsing did:mailto:", e)
    return htmlResponse(400, getUnexpectedErrorResponseHTML('Invalid Account DID received.'))
  }

  // add a customer with a trial product
  const customerPutRes = await customerStore.put({
    customer,
    product: 'did:web:trial.storacha.network',
    details: JSON.stringify({ humanode: { id: humanodeId } }),
    insertedAt: new Date()
  })
  if (!customerPutRes.ok) {
    console.error(`putting customer: ${customer}`, customerPutRes.error)
    return htmlResponse(500, getUnexpectedErrorResponseHTML('Failed to update customer store.'))
  }

  await humanodeStore.add(humanodeId, customer)

  return htmlResponse(200, getResponseHTML())
}

export const handler = Sentry.AWSLambda.wrapHandler(
  wrapLambdaHandler('oauth-humanode-callback', (event) => oauthCallbackGet(event))
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

  const customerStore = createCustomerStore({ region }, { tableName: mustGetEnv('CUSTOMER_TABLE_NAME') })
  const humanodeStore = createHumanodesTable(region, mustGetEnv('HUMANODE_TABLE_NAME'))
  
  return {
    serviceSigner,
    customerStore,
    humanodeStore
  }
}

/**
 * @param {number} statusCode
 * @param {string} body 
 * @returns 
 */
function htmlResponse(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'text/html' },
    body: Buffer.from(body).toString('base64'),
    isBase64Encoded: true,
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
        <p>You have been granted a free Storacha storage plan.</p>
        <p>You may now close this window.</p>
      </div>
    </div>
  </body>
</html>
`.trim()

const getDuplicateHumanodeResponseHTML = () => `
<!doctype html>
<html lang="en">
  <head>
    <title>Authorized - Storacha Network</title>
  </head>
  <body style="font-family:sans-serif;color:#000">
    <div style="height:100vh;display:flex;align-items:center;justify-content:center">
      <div style="text-align:center">
        <img src="https://w3s.link/ipfs/bafybeihinjwsn3kgjrlpdada4xingozsni3boywlscxspc5knatftauety/storacha-bug.svg" alt="Storacha - Decentralized Hot Storage Layer on Filecoin">
        <h1 style="font-weight:normal">Plan Selection Unsuccessful</h1>
        <p>The identified human has already claimed their free plan.</p>
        <p>You may now close this window.</p>
      </div>
    </div>
  </body>
</html>
`.trim()

/**
 * 
 * @param {string} message 
 * @returns 
 */
const getUnexpectedErrorResponseHTML = (message) => `
<!doctype html>
<html lang="en">
  <head>
    <title>Authorized - Storacha Network</title>
  </head>
  <body style="font-family:sans-serif;color:#000">
    <div style="height:100vh;display:flex;align-items:center;justify-content:center">
      <div style="text-align:center">
        <img src="https://w3s.link/ipfs/bafybeihinjwsn3kgjrlpdada4xingozsni3boywlscxspc5knatftauety/storacha-bug.svg" alt="Storacha - Decentralized Hot Storage Layer on Filecoin">
        <h1 style="font-weight:normal">Unexpected Error</h1>
        <p>An unexpected error occured while trying to authenticate you: ${message} </p>
        <p>Please close this window and try again.</p>
      </div>
    </div>
  </body>
</html>
`.trim()
