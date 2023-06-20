import { connect } from '@ucanto/client'
import { CAR, HTTP } from '@ucanto/transport'
import * as DID from '@ipld/dag-ucan/did'
import * as Signer from '@ucanto/principal/ed25519'
import { importDAG } from '@ucanto/core/delegation'
import { CarReader } from '@ipld/car'
import { AgentData } from '@web3-storage/access/agent'
import { Client } from '@web3-storage/w3up-client'
import { MailSlurp } from "mailslurp-client"

/**
 * Get w3up-client configured with staging endpoints and CI Keys.
 *
 * @param {string} uploadServiceUrl
 * @param {object} [options]
 * @param {boolean} [options.shouldRegister]
 */
export async function getClient(uploadServiceUrl, options = {}) {
  // Load client with specific private key
  const principal = Signer.parse(process.env.INTEGRATION_TESTS_UCAN_KEY || '')
  const data = await AgentData.create({ principal })

  const client = new Client(data, {
    serviceConf: {
      upload: getUploadServiceConnection(uploadServiceUrl),
      access: getAccessServiceConnection(uploadServiceUrl)
    },
  })

  // Add proof that this agent has been delegated capabilities on the space
  const proof = await parseProof(process.env.INTEGRATION_TESTS_PROOF || '')
  const space = await client.addSpace(proof)
  await client.setCurrentSpace(space.did())

  return client
}

/**
 * 
 * @param {string} email 
 * @param {string} uploadServiceUrl
 */
function getAuthLinkFromEmail (email, uploadServiceUrl) {
  // forgive me for I have s̵i̵n̴n̴e̵d̴ ̸a̸n̵d̷ ̷p̶a̵r̵s̵e̸d̷ Ȟ̷̞T̷̢̈́M̸̼̿L̴̎ͅ ̵̗̍ẅ̵̝́ï̸ͅt̴̬̅ḫ̸̔ ̵͚̔ŗ̵͊e̸͍͐g̶̜͒ė̷͖x̴̱̌
  // TODO we should update the email and add an ID to this element to make this more robust at some point 
  const link = email.match(/<a href="([^"]*)".*Verify email address/)[1]

  // test auth services always link to the staging URL but we want to hit the service we're testing
  return link.replace("https://w3access-staging.protocol-labs.workers.dev", uploadServiceUrl)
}

async function createMailSlurpInbox() {
  const apiKey = process.env.MAILSLURP_API_KEY
  const mailslurp = new MailSlurp({ apiKey })
  const inbox = await mailslurp.inboxController.createInbox({})
  return {
    mailslurp,
    id: inbox.id,
    email: inbox.emailAddress
  }
}

export async function setupNewClient (uploadServiceUrl, options = {}) {
  // create an inbox
  const { mailslurp, id: inboxId, email } = await createMailSlurpInbox()
  const principal = await Signer.generate()
  const data = await AgentData.create({ principal })
  const client = new Client(data, {
    serviceConf: {
      upload: getUploadServiceConnection(uploadServiceUrl),
      access: getAccessServiceConnection(uploadServiceUrl)
    },
  })

  const timeoutMs = 30_000
  const authorizePromise = client.authorize(email)
  // click link in email
  const latestEmail = await mailslurp.waitForLatestEmail(inboxId, timeoutMs)
  const authLink = getAuthLinkFromEmail(latestEmail.body, uploadServiceUrl)
  await fetch(authLink, { method: 'POST' })
  await authorizePromise
  if (!client.currentSpace()) {
    const space = await client.createSpace("test space")
    await client.setCurrentSpace(space.did())
    await client.registerSpace(email)
  }

  return client
}

/** @param {string} data Base64 encoded CAR file */
async function parseProof (data) {
  const blocks = []
  const reader = await CarReader.fromBytes(Buffer.from(data, 'base64'))
  for await (const block of reader.blocks()) {
    blocks.push(block)
  }
  // @ts-expect-error incompatible CID type versions in dependencies
  return importDAG(blocks)
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
