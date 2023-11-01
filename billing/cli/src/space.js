import { Signer } from '@ucanto/principal/ed25519'
import { Schema } from '../../data/lib.js'
import { expect, mustGetEnv } from '../../functions/lib.js'
import { getDynamo } from './lib.js'
import { randomLink } from '../../test/helpers/dag.js'
import { PutItemCommand } from '@aws-sdk/client-dynamodb'
import { marshall } from '@aws-sdk/util-dynamodb'
import { startOfLastMonth } from '../../lib/util.js'
import { createSpaceSnapshotStore } from '../../tables/space-snapshot.js'

/**
 * @param {string} customerParam
 */
export const spaceAdd = async (customerParam) => {
  const customer = Schema.did({ method: 'mailto' }).from(customerParam)

  const signer = await Signer.generate()
  const space = signer.did()
  const provider = 'did:web:web3.storage'
  const subscription = randomLink().toString()

  const consumerTableName = mustGetEnv('CONSUMER_TABLE_NAME')
  const subscriptionTableName = mustGetEnv('SUBSCRIPTION_TABLE_NAME')
  const spaceSnapshotTableName = mustGetEnv('SPACE_SNAPSHOT_TABLE_NAME')
  const dynamo = getDynamo()
  const now = new Date()

  await dynamo.send(new PutItemCommand({
    TableName: consumerTableName,
    Item: marshall({
      consumer: space,
      provider,
      subscription,
      cause: randomLink().toString(),
      insertedAt: now.toISOString(),
      updatedAt: now.toISOString()
    })
  }))

  await dynamo.send(new PutItemCommand({
    TableName: subscriptionTableName,
    Item: marshall({
      customer,
      provider,
      subscription,
      cause: randomLink().toString(),
      insertedAt: now.toISOString(),
      updatedAt: now.toISOString()
    })
  }))

  const spaceSnapshotStore = createSpaceSnapshotStore(dynamo, {
    tableName: spaceSnapshotTableName
  })

  expect(
    await spaceSnapshotStore.put({
      provider,
      space,
      size: 0n,
      recordedAt: startOfLastMonth(now),
      insertedAt: now
    }),
    'putting space snapshot'
  )

  await dynamo.send(new PutItemCommand({
    TableName: spaceSnapshotTableName,
    Item: marshall({
      pk: `${space}#${provider}`,
      space,
      provider,
      size: 0,
      recordedAt: startOfLastMonth(now).toISOString(),
      insertedAt: now.toISOString()
    })
  }))

  console.log({ ok: { space } })
}
