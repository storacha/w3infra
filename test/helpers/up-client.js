import { connect } from '@ucanto/client'
import { CAR, HTTP } from '@ucanto/transport'
import * as DID from '@ipld/dag-ucan/did'
import * as Signer from '@ucanto/principal/ed25519'
import { importDAG } from '@ucanto/core/delegation'
import { CarReader } from '@ipld/car'
import { AgentData } from '@web3-storage/access/agent'

import { Client } from '@web3-storage/w3up-client'

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
      access: getAccessServiceConnection()
    },
  })

  // Add proof that this agent has been delegated capabilities on the space
  const proof = await parseProof(process.env.INTEGRATION_TESTS_PROOF || '')
  const space = await client.addSpace(proof)
  await client.setCurrentSpace(space.did())

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


function getAccessServiceConnection() {
  const accessServiceURL = new URL('https://w3access-staging.protocol-labs.workers.dev')
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
