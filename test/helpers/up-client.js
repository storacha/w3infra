import { connect } from '@ucanto/client'
import { CAR, HTTP } from '@ucanto/transport'
import * as DID from '@ipld/dag-ucan/did'
import * as Signer from '@ucanto/principal/ed25519'
import { AgentData } from '@web3-storage/access/agent'
import { Client } from '@web3-storage/w3up-client'
import { MailSlurp } from "mailslurp-client"

/**
 * 
 * @param {string} email 
 * @param {string} uploadServiceUrl
 */
function getAuthLinkFromEmail (email, uploadServiceUrl) {
  // forgive me for I have s̵i̵n̴n̴e̵d̴ ̸a̸n̵d̷ ̷p̶a̵r̵s̵e̸d̷ Ȟ̷̞T̷̢̈́M̸̼̿L̴̎ͅ ̵̗̍ẅ̵̝́ï̸ͅt̴̬̅ḫ̸̔ ̵͚̔ŗ̵͊e̸͍͐g̶̜͒ė̷͖x̴̱̌
  // TODO we should update the email and add an ID to this element to make this more robust - tracked in https://github.com/web3-storage/w3infra/issues/208
  const link = email.match(/<a href="([^"]*)".*Verify email address/)[1]

  // test auth services always link to the staging URL but we want to hit the service we're testing
  return link.replace("https://staging.up.web3.storage", uploadServiceUrl)
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
  console.log("creating mailslurp inbox")
  const { mailslurp, id: inboxId, email } = await createMailSlurpInbox()
  console.log("creating new client")
  const client = await createNewClient(uploadServiceUrl)
  console.log("created new client")
  const timeoutMs = process.env.MAILSLURP_TIMEOUT ? parseInt(process.env.MAILSLURP_TIMEOUT) : 120_000
  const authorizePromise = client.authorize(email)
  // click link in email
  console.log("waiting for email")
  const latestEmail = await mailslurp.waitForLatestEmail(inboxId, timeoutMs)
  console.log("got auth link")
  const authLink = getAuthLinkFromEmail(latestEmail.body, uploadServiceUrl)
  console.log("clicking auth link")
  const authResult = await fetch(authLink, { method: 'POST' })
  console.log("got auth result", authResult.status, authResult.statusText, await authResult.text())
  console.log("waiting for authorize to return")
  await authorizePromise
  if (!client.currentSpace()) {
    console.log("creating space")
    const space = await client.createSpace("test space")
    console.log("setting current space")
    await client.setCurrentSpace(space.did())
    console.log("registering space")
    await client.registerSpace(email)
  }
  console.log("done with setup")

  return client
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
