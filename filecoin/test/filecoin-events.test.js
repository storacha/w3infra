import { testService as test } from './helpers/context.js'
import { test as filecoinApiTest } from '@web3-storage/filecoin-api/test'
import * as Signer from '@ucanto/principal/ed25519'
import { Consumer } from 'sqs-consumer'
import pWaitFor from 'p-wait-for'
import delay from 'delay'
import { fromString } from 'uint8arrays/from-string'
import { decode as JSONdecode } from '@ipld/dag-json'
import { getMockService, getConnection } from '@web3-storage/filecoin-api/test/context/service'

import { createDynamodDb, createS3, createQueue } from './helpers/resources.js'
import { getQueues, getStores } from './helpers/service-context.js'

/**
 * @typedef {import('./helpers/context.js').QueueContext} QueueContext
 */

const queueNames = ['pieceOfferQueue', 'filecoinSubmitQueue']

test.before(async (t) => {
  await delay(1000)
  /** @type {Record<string, QueueContext>} */
  const queues = {}
  // /** @type {import('@aws-sdk/client-sqs').Message[]} */
  /** @type {Map<string, unknown[]>} */
  const queuedMessages = new Map()

  for (const name of queueNames) {
    const sqs = await createQueue()
    queuedMessages.set(name, [])
    const queueConsumer = Consumer.create({
      queueUrl: sqs.queueUrl,
      sqs: sqs.client,
      handleMessage: (message) => {
        // @ts-expect-error may not have body
        const decodedBytes = fromString(message.Body)
        const decodedMessage = JSONdecode(decodedBytes)
        const messages = queuedMessages.get(name) || []
        messages.push(decodedMessage)
        return Promise.resolve()
      }
    })

    queues[name] = {
      sqsClient: sqs.client,
      queueName: sqs.queueName,
      queueUrl: sqs.queueUrl,
      queueConsumer,
    }
  }

  const { client } = await createS3({ port: 9000 })
  const dynamo = await createDynamodDb()

  Object.assign(t.context, {
    s3Client: client,
    dynamoClient: dynamo.client,
    queues,
    queuedMessages
  })
})

test.beforeEach(async t => {
  await delay(1000)
  for (const name of queueNames) {
    t.context.queuedMessages.set(name, [])
  }
  for (const [, q] of Object.entries(t.context.queues)) {
    q.queueConsumer.start()
    await pWaitFor(() => q.queueConsumer.isRunning)
  }
})

test.afterEach(async t => {
  for (const [, q] of Object.entries(t.context.queues)) {
    q.queueConsumer.stop()
    await delay(1000)
  }
})

test.after(async t => {
  await delay(1000)
})

for (const [title, unit] of Object.entries(filecoinApiTest.events.storefront)) {
  const define = title.startsWith('only ')
    // eslint-disable-next-line no-only-tests/no-only-tests
    ? test.only
    : title.startsWith('skip ')
    ? test.skip
    : test

  define(title, async (t) => {
    const queues = getQueues(t.context)
    const stores = await getStores(t.context)
    
    // context
    const storefrontSigner = await Signer.generate()
    const aggregatorSigner = await Signer.generate()
    const service = getMockService()
    const storefrontConnection = getConnection(
      storefrontSigner,
      service
    ).connection
    const aggregatorConnection = getConnection(
      aggregatorSigner,
      service
    ).connection

    await unit(
      {
        ok: (actual, message) => t.truthy(actual, message),
        equal: (actual, expect, message) =>
          t.is(actual, expect, message ? String(message) : undefined),
        deepEqual: (actual, expect, message) =>
          t.deepEqual(actual, expect, message ? String(message) : undefined),
      },
      {
        id: storefrontSigner,
        aggregatorId: aggregatorSigner,
        ...stores,
        ...queues,
        service,
        storefrontService: {
          connection: storefrontConnection,
          invocationConfig: {
            issuer: storefrontSigner,
            with: storefrontSigner.did(),
            audience: storefrontSigner,
          },
        },
        aggregatorService: {
          connection: aggregatorConnection,
          invocationConfig: {
            issuer: storefrontSigner,
            with: storefrontSigner.did(),
            audience: aggregatorSigner,
          },
        },
        errorReporter: {
          catch(error) {
            t.fail(error.message)
          },
        },
        queuedMessages: t.context.queuedMessages,
        validateAuthorization: () => ({ ok: {} })
      }
    )
  })
}
