import { connect } from '@ucanto/client'
import { CAR, HTTP } from '@ucanto/transport'
import * as DID from '@ipld/dag-ucan/did'
import * as Signer from '@ucanto/principal/ed25519'
import { AgentData } from '@web3-storage/access/agent'
import { Client } from '@web3-storage/w3up-client'
import { MailSlurp } from "mailslurp-client"
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'

import * as BlobCapabilities from '@web3-storage/capabilities/blob'

import { add } from './blob-client.js'

dotenv.config({ path: fileURLToPath(new URL('../../.env', import.meta.url)) })

/**
 * 
 * @param {string} email 
 * @param {string} accessServiceUrl
 */
function getAuthLinkFromEmail (email, accessServiceUrl) {
  // forgive me for I have s̵i̵n̴n̴e̵d̴ ̸a̸n̵d̷ ̷p̶a̵r̵s̵e̸d̷ Ȟ̷̞T̷̢̈́M̸̼̿L̴̎ͅ ̵̗̍ẅ̵̝́ï̸ͅt̴̬̅ḫ̸̔ ̵͚̔ŗ̵͊e̸͍͐g̶̜͒ė̷͖x̴̱̌
  // TODO we should update the email and add an ID to this element to make this more robust - tracked in https://github.com/web3-storage/w3infra/issues/208
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

export async function createNewClient(uploadServiceUrl) {
  const principal = await Signer.generate()
  const data = await AgentData.create({ principal })
  return new Client(data, {
    serviceConf: {
      upload: getUploadServiceConnection(uploadServiceUrl),
      access: getAccessServiceConnection(uploadServiceUrl)
    },
  })
}

export async function setupNewClient (uploadServiceUrl, options = {}) {
  // create an inbox
  const { mailslurp, id: inboxId, email } = options.inbox || await createMailSlurpInbox()
  const client = await createNewClient(uploadServiceUrl)
  const timeoutMs = process.env.MAILSLURP_TIMEOUT ? parseInt(process.env.MAILSLURP_TIMEOUT) : 60_000
  const authorizePromise = client.login(email)
  // click link in email
  const latestEmail = await mailslurp.waitForLatestEmail(inboxId, timeoutMs)
  const authLink = getAuthLinkFromEmail(latestEmail.body, uploadServiceUrl)
  const res = await fetch(authLink, { method: 'POST' })
  if (!res.ok) {
    throw new Error('failed to authenticate by clickling on auth link from e-mail')
  }
  const account = await authorizePromise
  if (!client.currentSpace()) {
    const space = await client.createSpace("test space")
    await account.provision(space.did())
    await space.save()
  }

  return client
}


/**
 * @param {Client} client
 * @param {string} serviceUrl
 * @param {string} capability
 */
export function getServiceProps (client, serviceUrl, capability) {
  // Get invocation config
  const resource = client.agent.currentSpace()
  if (!resource) {
    throw new Error(
      'missing current space: use createSpace() or setCurrentSpace()'
    )
  }

  const connection = getUploadServiceConnection(serviceUrl)

  return {
    connection,
    conf: {
      issuer: client.agent.issuer,
      with: resource,
      proofs: client.agent.proofs(
        [BlobCapabilities.add.can].map((can) => ({ can, with: resource }))
      ),
      audience: DID.parse('did:web:staging.web3.storage')
    }
  }
}

export async function setupNewClientWithBlob (uploadServiceUrl, options = {}) {
  const client = await setupNewClient(uploadServiceUrl, options)

  // Get invocation config
  const serviceProps = getServiceProps(client, uploadServiceUrl, BlobCapabilities.add.can)

  return {
    client,
    blobClient: {
      add: (data) => add(serviceProps.conf, data, { connection: serviceProps.connection })
    }
  }
}

/**
 * @param {string} serviceUrl
 */
function getAccessServiceConnection(serviceUrl) {
  const accessServiceURL = new URL(serviceUrl)
  const accessServicePrincipal = DID.parse('did:web:staging.web3.storage')

  return connect({
    id: accessServicePrincipal,
    codec: CAR.outbound,
    channel: HTTP.open({
      url: accessServiceURL,
      method: 'POST'
    }),
  })
}

/**
 * @param {string} serviceUrl
 */
function getUploadServiceConnection(serviceUrl) {
  const uploadServiceURL = new URL(serviceUrl)
  const uploadServicePrincipal = DID.parse('did:web:staging.web3.storage')

  return connect({
    id: uploadServicePrincipal,
    codec: CAR.outbound,
    channel: HTTP.open({
      url: uploadServiceURL,
      method: 'POST'
    })
  })
}
