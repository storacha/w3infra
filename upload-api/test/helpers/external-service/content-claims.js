// eslint-disable-next-line no-unused-vars
import * as API from '@storacha/upload-api/types'
import { connect } from '@ucanto/client'
import { ed25519 } from '@ucanto/principal'
import { CAR, HTTP } from '@ucanto/transport'
import { Assert } from '@web3-storage/content-claims/capability'
import * as Client from '@web3-storage/content-claims/client'
import * as Server from '@web3-storage/content-claims/server'
import { ClaimStorage } from '@web3-storage/content-claims-infra/lib/store'

/**
 * @param {object} params
 * @param {API.Signer} params.serviceSigner
 * @param {API.Transport.Channel<API.ClaimsService>} params.channel
 * @returns {Promise<API.ClaimsClientConfig>}
 */
export const create = async ({ serviceSigner, channel }) => {
  const agent = await ed25519.generate()
  const proofs = [
    await Assert.assert.delegate({
      issuer: serviceSigner,
      with: serviceSigner.did(),
      audience: agent,
    }),
  ]
  return {
    invocationConfig: {
      issuer: agent,
      with: serviceSigner.did(),
      audience: serviceSigner,
      proofs,
    },
    connection: connect({
      id: serviceSigner,
      codec: CAR.outbound,
      channel,
    }),
  }
}

/**
 * @param {{
 *   http?: import('node:http')
 *   s3: import('@aws-sdk/client-s3').S3Client
 *   bucketName: string
 *   dynamo: import('@aws-sdk/client-dynamodb').DynamoDBClient
 *   tableName: string
 * }} options
 * @returns {Promise<API.ClaimsClientConfig & API.ClaimReader & API.Deactivator>}
 */
export const activate = async ({ http, s3, bucketName, dynamo, tableName }) => {
  const serviceSigner = await ed25519.generate()

  const claimStore = new ClaimStorage({
    bucket: { s3Client: s3, bucketName },
    table: { dynamoClient: dynamo, tableName }
  })
  /** @param {API.MultihashDigest} content */
  const read = async (content) => {
    /** @type {import('@web3-storage/content-claims/client/api').Claim[]} */
    const claims = []
    await Server.walkClaims(
      { claimFetcher: claimStore },
      content,
      new Set()
    ).pipeTo(
      new WritableStream({
        async write(block) {
          const claim = await Client.decode(block.bytes)
          claims.push(claim)
        },
      })
    )
    return { ok: claims }
  }

  const server = Server.createServer({
    id: serviceSigner,
    codec: CAR.inbound,
    claimStore,
    validateAuthorization: () => ({ ok: {} }),
  })

  if (!http) {
    const conf = await create({ serviceSigner, channel: server })
    return Object.assign(conf, { read, deactivate: async () => {} })
  }

  const httpServer = http.createServer(async (req, res) => {
    const chunks = []
    for await (const chunk of req) {
      chunks.push(chunk)
    }

    const { headers, body } = await server.request({
      // @ts-expect-error
      headers: req.headers,
      body: new Uint8Array(await new Blob(chunks).arrayBuffer()),
    })

    res.writeHead(200, headers)
    res.write(body)
    res.end()
  })
  await new Promise((resolve) => httpServer.listen(resolve))
  // @ts-expect-error
  const { port } = httpServer.address()
  const serviceURL = new URL(`http://127.0.0.1:${port}`)

  const channel = HTTP.open({ url: serviceURL, method: 'POST' })
  const conf = await create({ serviceSigner, channel })
  return Object.assign(conf, {
    read,
    deactivate: () =>
      new Promise((resolve, reject) => {
        httpServer.closeAllConnections()
        httpServer.close((err) => {
          err ? reject(err) : resolve(undefined)
        })
      }),
  })
}
