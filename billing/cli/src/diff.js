import { DynamoDBClient, QueryCommand } from '@aws-sdk/client-dynamodb'
import { createStorePutterClient, createStoreGetterClient } from '../../tables/client.js'
import * as SpaceDiff from '../../data/space-diff.js'
import * as Consumer from '../../data/consumer.js'
import * as Subscription from '../../data/subscription.js'
import { randomLink } from '../../test/helpers/dag.js'
import { mustGetEnv } from '../../functions/lib.js'
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb'
import Bytes from 'bytes'

/**
 * Remove some bytes to the space at the passed ISO timestamp.
 * 
 * $ billing diff remove did:key:space0 3MB 2023-09-16T09:00:00.000Z
 * 
 * @param {string} space
 * @param {string} rawBytes 
 * @param {string} datetime
 */
export async function diffRemove(space, rawBytes, datetime) {
  const change = Bytes(rawBytes) * -1
  await insertDiff(space, change, datetime)
}

/**
 * Add some bytes to the space at the passed ISO timestamp.
 * 
 * $ billing diff add did:key:space0 3MB 2023-09-16T09:00:00.000Z
 * 
 * @param {string} space
 * @param {string} rawBytes 
 * @param {string} datetime
 */
export async function diffAdd (space, rawBytes, datetime) {
  const change = Bytes(rawBytes)
  await insertDiff(space, change, datetime)
}

/**
 * Insert a diff record
 * 
 * @param {string} space
 * @param {number} change - positive or negative integer in bytes
 * @param {string} datetime
 */
async function insertDiff (space, change, datetime) {
  const receiptAt = new Date(datetime)
  if (!isValidDate) {
    throw new Error(`${datetime} is not a valid date-time`)
  }
  const region = process.env.AWS_REGION
  const dynamo = new DynamoDBClient({ region })
  const consumer = await getConsumerBySpace(dynamo, space)
  const subscriptionStore = createStoreGetterClient( dynamo, {
    tableName: mustGetEnv('SUBSCRIPTION_TABLE_NAME'),
    ...Subscription
  })
  const subscription = await okOrThrow(subscriptionStore, consumer)
  const spaceDiffStore = createStorePutterClient(dynamo, {
    tableName: mustGetEnv('SPACE_DIFF_TABLE_NAME'),
    ...SpaceDiff
  })
  const res = await spaceDiffStore.put({
    cause: randomLink(),
    customer: subscription.customer,
    space: consumer.consumer,
    subscription: subscription.subscription,
    insertedAt: new Date(),
    provider: 'did:web:web3.storage',
    change,
    receiptAt
  })
  console.log(res)

}

/** @param {Date} d */
function isValidDate (d) {
  return !isNaN(d.getTime())
}

/**
 * @param {DynamoDBClient} dynamo
 * @param {string} space
 */
export async function getConsumerBySpace (dynamo, space) {
  const res = await dynamo.send(new QueryCommand({
    TableName: mustGetEnv('CONSUMER_TABLE_NAME'),
    IndexName: 'consumer',
    KeyConditionExpression: "consumer = :consumer",
    ExpressionAttributeValues: marshall({
      ":consumer": space
    })
  }))
  if (!res.Items || res.Items.length === 0) {
    throw new Error(`Failed to get consumer for ${space}`)
  }
  const decoded = Consumer.decode(unmarshall(res.Items[0]))
  if (decoded.error) {
    throw new Error(decoded.error.message)
  }
  return decoded.ok
}

/**
 * @template {object} K
 * @template V
 * @param {import('../../lib/api.js').StoreGetter<K,V>} storeGetter
 * @param {K} key
 */
async function okOrThrow (storeGetter, key) {
  const res = await storeGetter.get(key)
  if (res.error) {
    throw new Error(res.error.message)
  }
  return res.ok
}
