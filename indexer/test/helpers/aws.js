import { GenericContainer as Container } from 'testcontainers'
import { CreateQueueCommand, SQSClient } from '@aws-sdk/client-sqs'
import { webcrypto } from '@storacha/one-webcrypto'

/**
 * @template T
 * @typedef {{ client: T, endpoint: string }} AWSService
 */

/** @param {{ port?: number, region?: string }} [opts] */
export const createSQS = async (opts = {}) => {
  console.log('Creating local SQS...')
  const port = opts.port || 9324
  const region = opts.region || 'elasticmq'
  const container = await new Container('softwaremill/elasticmq-native')
    .withExposedPorts(port)
    .start()
  const endpoint = `http://${container.getHost()}:${container.getMappedPort(9324)}`
  return { client: new SQSClient({ region, endpoint }), endpoint }
}

/**
 * @param {import('@aws-sdk/client-sqs').SQSClient} sqs
 * @param {string} [pfx]
 */
export async function createQueue (sqs, pfx = '') {
  const name = pfx + webcrypto.randomUUID().split('-')[0]
  console.log(`Creating SQS queue "${name}"...`)
  const res = await sqs.send(new CreateQueueCommand({ QueueName: name }))
  if (!res.QueueUrl) throw new Error('missing queue URL')
  return res.QueueUrl
}
