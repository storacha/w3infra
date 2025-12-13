import { getDynamoClient } from '../lib/aws/dynamo.js'
import { mustGetEnv } from '../lib/env.js'
import { ScanCommand, UpdateItemCommand } from '@aws-sdk/client-dynamodb'
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb'

export async function updateSubscriptionConsumerProviders () {
  const {
    ENV,
    DRY_RUN,
  } = getEnv()

  const region = getRegion(ENV)
  const dynamoDb = getDynamoClient({region})
  const consumerTableName = getConsumerTableName(ENV)
  const subscriptionTableName = getSubscriptionTableName(ENV)

  const targetProvider = 'did:web:up.storacha.network'

  if (DRY_RUN) {
    console.log('🔍 DRY RUN MODE - No records will be updated')
  }

  // Migrate consumer table
  console.log('Migrating consumer table...')
  let consumerCount = 0
  /** @type {Record<string, import('@aws-sdk/client-dynamodb').AttributeValue> | undefined} */
  let consumerExclusiveStartKey = undefined

  do {
    const scanResult = await dynamoDb.send(new ScanCommand({
      TableName: consumerTableName,
      ExclusiveStartKey: consumerExclusiveStartKey
    }))

    for (const item of scanResult.Items || []) {
      const record = unmarshall(item)
      if (record.provider !== targetProvider) {
        if (!DRY_RUN) {
          await dynamoDb.send(new UpdateItemCommand({
            TableName: consumerTableName,
            Key: marshall({ provider: record.provider, subscription: record.subscription }),
            UpdateExpression: 'SET provider = :newProvider',
            ExpressionAttributeValues: {
              ':newProvider': { S: targetProvider }
            }
          }))
          console.log(`Updated consumer ${record.consumer} provider to ${targetProvider}`)
        } else {
          console.log(`[DRY RUN] Would update consumer ${record.consumer} provider to ${targetProvider}`)
        }
        consumerCount++
      }
    }

    consumerExclusiveStartKey = scanResult.LastEvaluatedKey
  } while (consumerExclusiveStartKey)

  console.log(`${DRY_RUN ? 'Would update' : 'Updated'} ${consumerCount} consumer records`)

  // Migrate subscription table
  console.log('Migrating subscription table...')
  let subscriptionCount = 0
  /** @type {Record<string, import('@aws-sdk/client-dynamodb').AttributeValue> | undefined} */
  let subscriptionExclusiveStartKey = undefined

  do {
    const scanResult = await dynamoDb.send(new ScanCommand({
      TableName: subscriptionTableName,
      ExclusiveStartKey: subscriptionExclusiveStartKey
    }))

    for (const item of scanResult.Items || []) {
      const record = unmarshall(item)
      if (record.provider !== targetProvider) {
        if (!DRY_RUN) {
          await dynamoDb.send(new UpdateItemCommand({
            TableName: subscriptionTableName,
            Key: marshall({ provider: record.provider, subscription: record.subscription }),
            UpdateExpression: 'SET provider = :newProvider',
            ExpressionAttributeValues: {
              ':newProvider': { S: targetProvider }
            }
          }))
          console.log(`Updated subscription ${record.subscription} provider to ${targetProvider}`)
        } else {
          console.log(`[DRY RUN] Would update subscription ${record.subscription} provider to ${targetProvider}`)
        }
        subscriptionCount++
      }
    }

    subscriptionExclusiveStartKey = scanResult.LastEvaluatedKey
  } while (subscriptionExclusiveStartKey)

  console.log(`${DRY_RUN ? 'Would update' : 'Updated'} ${subscriptionCount} subscription records`)


}

/**
 * Get Env validating it is set.
 */
function getEnv() {
  return {
    ENV: mustGetEnv('ENV'),
    DRY_RUN: process.env.DRY_RUN !== 'false',
  }
}

/**
 * @param {string} env
 */
function getRegion (env) {
  if (env === 'staging') {
    return 'us-east-2'
  }

  return 'us-west-2'
}

/**
 * @param {string} env
 */
function getConsumerTableName (env) {
  return `${env}-w3infra-consumer`
}

/**
 * @param {string} env
 */
function getSubscriptionTableName (env) {
  return `${env}-w3infra-subscription`
}
