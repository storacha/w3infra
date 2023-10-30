import { Signer } from '@ucanto/principal/ed25519'
import { asDIDMailto } from '../../data/lib.js'
import { mustGetEnv } from '../../functions/lib.js'
import { getDynamo } from './lib.js'
import { randomLink } from '../../test/helpers/dag.js'
import { PutItemCommand } from '@aws-sdk/client-dynamodb'
import { marshall } from '@aws-sdk/util-dynamodb'
import { startOfLastMonth } from '../../lib/util.js'

/**
 * @param {string} customerParam
 */
export const spaceAdd = async (customerParam) => {
  const customer = asDIDMailto(customerParam)

  const signer = await Signer.generate()
  const space = signer.did()
  const provider = 'did:web:web3.storage'
  const subscription = randomLink().toString()

  const consumerTableName = mustGetEnv('CONSUMER_TABLE_NAME')
  const subscriptionTableName = mustGetEnv('SUBSCRIPTION_TABLE_NAME')
  const spaceSnapshotTableName = mustGetEnv('SPACE_SNAPSHOT_TABLE_NAME')
  const dynamo = getDynamo()

  await dynamo.send(new PutItemCommand({
    TableName: consumerTableName,
    Item: marshall({
      consumer: space,
      provider,
      subscription,
      cause: randomLink().toString(),
      insertedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    })
  }))

  await dynamo.send(new PutItemCommand({
    TableName: subscriptionTableName,
    Item: marshall({
      customer,
      provider,
      subscription,
      cause: randomLink().toString(),
      insertedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    })
  }))

  await dynamo.send(new PutItemCommand({
    TableName: spaceSnapshotTableName,
    Item: marshall({
      pk: `${space}#${provider}`,
      space,
      provider,
      size: 0,
      recordedAt: startOfLastMonth().toISOString(),
      insertedAt: new Date().toISOString()
    })
  }))

  console.log(`Space: ${space}`)
}
