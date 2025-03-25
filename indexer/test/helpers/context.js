import { base58btc } from 'multiformats/bases/base58'
import * as Digest from 'multiformats/hashes/digest'
import { createSQS, createQueue } from './aws.js'
import { createQueueRemoverClient } from './queue.js'
import { createMultihashesQueue } from '../../queues/multihashes.js'

/**
 * @typedef {{
 *  dynamo: import('./aws.js').AWSService<import('@aws-sdk/client-dynamodb').DynamoDBClient>
 *  sqs: import('./aws.js').AWSService<import('@aws-sdk/client-sqs').SQSClient>
 * }} AWSServices
 */

/** @type {AWSServices} */
let awsServices
const createAWSServices = async () => {
  awsServices = awsServices ?? {
    sqs: await createSQS()
  }
}

export const createBlockAdvertPublisherTestContext = async () => {
  await createAWSServices()

  const multihashesQueueURL = new URL(await createQueue(awsServices.sqs.client, 'multihashes-'))
  const multihashesQueue = {
    ...createMultihashesQueue(awsServices.sqs.client, { url: multihashesQueueURL }),
    ...createQueueRemoverClient(awsServices.sqs.client, {
      url: multihashesQueueURL,
      /** @type {import('../lib/api.js').Decoder<string, import('multiformats').MultihashDigest>} */
      decode: record => ({ ok: Digest.decode(base58btc.decode(record)) })
    })
  }

  return { multihashesQueue }
}

/**
 * @template C
 * @param {import('../lib/api.js').TestSuite<C>} suite
 * @param {() => Promise<C>} createContext
 */
export const bindTestContext = (suite, createContext) => {
  /** @type {import('../lib/api.js').TestSuite<C>} */
  const test = {}
  for (const [name, impl] of Object.entries(suite)) {
    test[name] = async (assert) => impl(assert, await createContext())
  }
  return test
}
