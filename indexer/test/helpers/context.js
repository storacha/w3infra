import { base58btc } from 'multiformats/bases/base58'
import * as Digest from 'multiformats/hashes/digest'
import { createDynamoDB, createSQS, createQueue, createTable } from './aws.js'
import { createQueueRemoverClient } from './queue.js'
import { createMultihashesQueue } from '../../queues/multihashes.js'
import { blocksCarsPositionTableProps, createBlocksCarsPositionStore } from '../../tables/blocks-cars-position.js'
import { createStoreListerClient } from '../helpers/table.js'

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
    sqs: await createSQS(),
    dynamo: await createDynamoDB()
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

export const createBlockIndexWriterTestContext = async () => {
  await createAWSServices()

  const blocksCarsPositionTableName = await createTable(awsServices.dynamo.client, blocksCarsPositionTableProps, 'blocks-cars-position-')
  const blocksCarsPositionStore = {
    ...createBlocksCarsPositionStore(awsServices.dynamo.client, {
      tableName: blocksCarsPositionTableName
    }),
    ...createStoreListerClient(awsServices.dynamo.client, {
      tableName: blocksCarsPositionTableName,
      /** @type {import('../../lib/api.js').Encoder<import('multiformats').MultihashDigest, { blockmultihash: string }>} */
      encodeKey: digest => ({ ok: { blockmultihash: base58btc.encode(digest.bytes) } }),
      /** @type {import('../lib/api.js').Decoder<import('../../types.js').StoreRecord, import('../../lib/api.js').Location>} */
      decode: record => ({
        ok: {
          digest: Digest.decode(base58btc.decode(String(record.blockmultihash))),
          location: new URL(String(record.carpath)),
          range: [Number(record.offset), Number(record.length)]
        }
      })
    })
  }

  return { blocksCarsPositionStore }
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
