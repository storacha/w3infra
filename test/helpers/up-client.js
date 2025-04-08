import * as DID from '@ipld/dag-ucan/did'
import * as Signer from '@ucanto/principal/ed25519'
import { AgentData } from '@storacha/access/agent'
import { Client, authorizeContentServe } from '@storacha/client'
import { uploadServiceConnection, accessServiceConnection, gatewayServiceConnection, filecoinServiceConnection } from '@storacha/client/service'
import { MailSlurp } from "mailslurp-client"
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'
import { getApiEndpoint } from './deployment.js'
import { mustGetEnv } from '../../lib/env.js'

dotenv.config({ path: fileURLToPath(new URL('../../.env', import.meta.url)) })

export const accessServiceURL = new URL(getApiEndpoint())
export const accessServicePrincipal = DID.parse(mustGetEnv('UPLOAD_API_DID'))

export const uploadServiceURL = new URL(getApiEndpoint())
export const uploadServicePrincipal = DID.parse(mustGetEnv('UPLOAD_API_DID'))

export const filecoinServiceURL = new URL(getApiEndpoint())
export const filecoinServicePrincipal = DID.parse(mustGetEnv('UPLOAD_API_DID'))

export const gatewayServiceURL = new URL(mustGetEnv('INTEGRATION_TESTS_GATEWAY_ENDPOINT'))
export const gatewayServicePrincipal = DID.parse(mustGetEnv('INTEGRATION_TESTS_GATEWAY_DID'))

export const serviceConf = {
  upload: uploadServiceConnection({
    id: uploadServicePrincipal,
    url: uploadServiceURL
  }),
  access: accessServiceConnection({
    id: accessServicePrincipal,
    url: accessServiceURL
  }),
  filecoin: filecoinServiceConnection({
    id: filecoinServicePrincipal,
    url: filecoinServiceURL
  }),
  gateway: gatewayServiceConnection({
    id: gatewayServicePrincipal,
    url: gatewayServiceURL
  })
}

export const receiptsEndpoint = new URL('/receipt/', uploadServiceURL)

/** @param {string} email */
function getAuthLinkFromEmail (email) {
  // forgive me for I have s̵i̵n̴n̴e̵d̴ ̸a̸n̵d̷ ̷p̶a̵r̵s̵e̸d̷ Ȟ̷̞T̷̢̈́M̸̼̿L̴̎ͅ ̵̗̍ẅ̵̝́ï̸ͅt̴̬̅ḫ̸̔ ̵͚̔ŗ̵͊e̸͍͐g̶̜͒ė̷͖x̴̱̌
  // TODO we should update the email and add an ID to this element to make this more robust - tracked in https://github.com/storacha/w3infra/issues/208
  const link = email.match(/<a href="([^"]*)".*Verify email address/)[1]
  if (!link){
    throw new Error(`Could not find email verification link in ${email}`)
  }
  return link
}

export async function createMailSlurpInbox() {
  const apiKey = process.env.MAILSLURP_API_KEY
  const mailslurp = new MailSlurp({ apiKey })
  const inbox = await mailslurp.inboxController.createInbox({})
  return {
    mailslurp,
    id: inbox.id,
    email: inbox.emailAddress
  }
}

export async function createNewClient() {
  const principal = await Signer.generate()
  const data = await AgentData.create({ principal })
  return new Client(data, { serviceConf, receiptsEndpoint })
}

export async function setupNewClient (options = {}) {
  // create an inbox
  const { mailslurp, id: inboxId, email } = options.inbox || await createMailSlurpInbox()
  const client = await createNewClient()
  const timeoutMs = process.env.MAILSLURP_TIMEOUT ? parseInt(process.env.MAILSLURP_TIMEOUT) : 60_000
  const authorizePromise = client.login(email)
  const [account] = await Promise.all([
    authorizePromise,
    (async () => {
      // click link in email
      const latestEmail = await mailslurp.waitForLatestEmail(inboxId, timeoutMs)
      const authLink = getAuthLinkFromEmail(latestEmail.body)
      const res = await fetch(authLink, { method: 'POST' })
      if (!res.ok) {
        throw new Error('failed to authenticate by clickling on auth link from e-mail')
      }
    })()
  ])
  if (!client.currentSpace()) {
    const space = await client.createSpace("test space")
    await account.provision(space.did())
    await authorizeContentServe(client, space, serviceConf.gateway)
    await space.save()
  }

  return { client, account }
}


/**
 * @param {Client} client
 * @param {string[]} caps
 */
export function getServiceProps (client, caps) {
  // Get invocation config
  const resource = client.agent.currentSpace()
  if (!resource) {
    throw new Error(
      'missing current space: use createSpace() or setCurrentSpace()'
    )
  }

  return {
    connection: serviceConf.upload,
    conf: {
      issuer: client.agent.issuer,
      with: resource,
      proofs: client.agent.proofs(caps.map((can) => ({ can, with: resource }))),
      audience: serviceConf.upload.id
    }
  }
}
