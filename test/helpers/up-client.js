import * as DID from '@ipld/dag-ucan/did'
import * as Signer from '@ucanto/principal/ed25519'
import { AgentData } from '@storacha/access/agent'
import { Client, authorizeContentServe } from '@storacha/client'
import { uploadServiceConnection, accessServiceConnection, gatewayServiceConnection, filecoinServiceConnection } from '@storacha/client/service'
import * as DIDMailto from '@storacha/did-mailto'
import { MailSlurp } from 'mailslurp-client'
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
  const link = email.match(/<a href="([^"]*)".*Verify email address/)?.[1]
  if (!link){
    throw new Error(`Could not find email verification link in ${email}`)
  }
  return link
}

export async function createMailSlurpInbox() {
  const apiKey = mustGetEnv('MAILSLURP_API_KEY')
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

/**
 * @param {object} [options]
 * @param {{ mailslurp: MailSlurp, id: string, email: string }} [options.inbox]
 */
export async function setupNewClient (options = {}) {
  console.log('Setting up new client...')
  console.log('Creating mailslurp inbox...')
  const { mailslurp, id: inboxId, email } = options.inbox || await createMailSlurpInbox()
  console.log(`  Email: ${email}`)
  console.log(`  Inbox: ${inboxId}`)

  console.log('Creating client instance...')
  const client = await createNewClient()
  console.log(`  Agent: ${client.did()}`)
  console.log(`  Access Service: ${accessServicePrincipal.did()}`)
  console.log(`    URL: ${accessServiceURL}`)
  console.log(`  Upload Service: ${uploadServicePrincipal.did()}`)
  console.log(`    URL: ${uploadServiceURL}`)
  console.log(`  Filecoin Service: ${filecoinServicePrincipal.did()}`)
  console.log(`    URL: ${filecoinServiceURL}`)
  console.log(`  Receipts:`)
  console.log(`    URL: ${receiptsEndpoint}`)

  const [,account] = await Promise.all([
    (async () => {
      console.log('Waiting for authorization email...')
      const timeoutMs = process.env.MAILSLURP_TIMEOUT ? parseInt(process.env.MAILSLURP_TIMEOUT) : 60_000
      const latestEmail = await mailslurp.waitForLatestEmail(inboxId, timeoutMs)
      if (!latestEmail.body) {
        throw new Error('missing body in latest email from mailslurp')
      }
      const authLink = getAuthLinkFromEmail(latestEmail.body)
      console.log(`Clicking authorization link...`)
      console.log(`  Link: ${authLink}`)
      const res = await fetch(authLink, { method: 'POST' })
      if (!res.ok) {
        throw new Error(`failed to authenticate by clickling on auth link from e-mail: ${res.status}: ${await res.text()}`)
      }
    })(),
    (async () => {
      // ensure mailslurp waitForLatestEmail request is sent first
      await new Promise(resolve => setTimeout(resolve, 500))
      console.log('Logging in...')
      console.log(`  Email: ${email}`)
      return client.login(DIDMailto.email(email))
    })(),
  ])

  if (!client.currentSpace()) {
    console.log('Creating space...')
    const space = await client.createSpace("test space")
    console.log(`  Space: ${space.did()}`)
    console.log('Provisioning space...')
    console.log(`  Account: ${account.did()}`)
    const provRes = await account.provision(space.did())
    if (provRes.error) {
      throw new Error(
        `provisioning space: ${provRes.error.message}`,
        { cause: provRes.error }
      )
    }
    console.log('Authorizing gateway...')
    console.log(`  Gateway Service: ${gatewayServicePrincipal.did()}`)
    console.log(`    URL: ${gatewayServiceURL}`)
    await authorizeContentServe(client, space, serviceConf.gateway)
    await space.save()
  }

  return { client, account }
}

/**
 * @param {Client} client
 * @param {import('@ipld/dag-ucan').Ability[]} caps
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
