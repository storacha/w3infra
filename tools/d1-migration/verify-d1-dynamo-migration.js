/* eslint max-depth: 0 */
import {
  DynamoDBClient,
  QueryCommand,
  GetItemCommand
} from '@aws-sdk/client-dynamodb'
import { CBOR } from '@ucanto/server'

import { exec as childProcessExec } from 'child_process'
import { mustGetEnv } from '../../lib/env.js'

/**
 * 
 * @param {string} command 
 * @returns 
 */
const exec = async (command) => {
  return new Promise((resolve, reject) => {
    childProcessExec(command, (error, stdout, stderr) => {
      if (error !== null) reject(error)
      if (stderr !== '') reject(stderr)
      else resolve(stdout)
    })
  })
}

async function loadFromD1 () {
  const {
    STAGE,
  } = getEnv()

  const dbName = (STAGE === 'prod') ? 'access' : 'access-staging'
  try {
    const delegations = JSON.parse(await exec(`wrangler d1 execute ${dbName} --command 'SELECT * from delegations_v3' --json`))[0].results
    const provisions = JSON.parse(await exec(`wrangler d1 execute ${dbName} --command 'SELECT * from provisions' --json`))[0].results
    return { delegations, provisions }
  } catch (e) {
    console.log('failed to load delegations and provisions from D1', e)
    throw e
  }
}

/** 
 * @typedef {{cid: string, audience: string, issuer: string, expiration: number | null, inserted_at: string, updated_at: string}} Delegation
 * @typedef {{cid: string, consumer: string, provider: string, sponsor: string, inserted_at: string, updated_at: string}} Provision
 * @param {{delegations: Delegation[], provisions: Provision[]}} data
 */
async function verifyInDynamo ({ delegations: allDelegations, provisions: allProvisions }) {
  const {
    STAGE,
  } = getEnv()

  const { client: delegationsClient, tableName: delegationsTableName } = getDynamoDb(
    'delegation',
    STAGE,
    getRegion(STAGE)
  )
  const { client: subscriptionsClient, tableName: subscriptionsTableName } = getDynamoDb(
    'subscription',
    STAGE,
    getRegion(STAGE)
  )
  const { client: consumersClient, tableName: consumersTableName } = getDynamoDb(
    'consumer',
    STAGE,
    getRegion(STAGE)
  )

  console.log('verifying delegations')
  for (const delegation of allDelegations) {
    console.log(`looking for delegation ${delegation.cid}`)
    const result = await delegationsClient.send(new GetItemCommand({
      TableName: delegationsTableName,
      Key: {
        link: {
          S: delegation.cid
        }
      }
    }))
    if (!result.Item) {
      throw new Error(`failed to find delegation ${delegation.cid} in Dynamo!`)
    }
  }


  console.log('verifying each customer has at least one space named the default way')
  // ensure each customer has at least one space - don't worry about additional spaces for now, we'll check that below
  for (const provision of allProvisions) {
    const subscriptionId = await customerToSubscription(provision.sponsor)
    console.log(`looking for subscription for customer ${provision.sponsor} with provider ${provision.provider} and subscription id ${subscriptionId}`)
    const result = await subscriptionsClient.send(new GetItemCommand({
      TableName: subscriptionsTableName,
      Key: {
        subscription: {
          S: subscriptionId
        },
        provider: {
          S: provision.provider
        }
      }
    }))
    if (!result.Item) {
      throw new Error(`failed to find subscription for customer ${provision.sponsor} with provider ${provision.provider} and subscription id ${subscriptionId} in Dynamo!`)
    }
  }

  // next, look through all of the customers and make sure they have the expected subscription and consumer records

  /**
   * @type {Record<string, Record<string, string[]>>}
   */
  const consumersByCustomerAndProvider = allProvisions.reduce((m, p) => {
    m[p.sponsor] ||= {}
    m[p.sponsor][p.provider] ||= /** @type {string[]} */([])
    m[p.sponsor][p.provider].push(p.consumer)
    return m
  }, /** @type {Record<string, Record<string, string[]>>} */({}))

  for (const [customer, providers] of Object.entries(consumersByCustomerAndProvider)) {
    for (const provider of Object.keys(providers)) {
      console.log(`verifying customer ${customer} with provider ${provider}`)
      const consumers = providers[provider]

      const result = await subscriptionsClient.send(new QueryCommand({
        TableName: subscriptionsTableName,
        IndexName: 'customer',
        KeyConditionExpression: 'customer = :c and provider = :p',
        ExpressionAttributeValues: {
          ':c': {
            S: customer
          },
          ':p': {
            S: provider
          }
        }
      }))
      if (result.Items && (result.Items.length === providers[provider].length)) {
        console.log(`verified ${customer} at ${provider} has ${result.Items?.length} subscription(s) in D1 and Dynamo`)
      } else {
        throw new Error(`found ${result.Items?.length} items in dynamo for ${customer} at ${provider} but expected ${consumers.length}`)
      }

      // for each consumer we found in D1, find corresponding records in the Dynamo consumers table and make sure they have 
      // the corresponding subscription records that we expect
      for (const consumer of consumers) {
        console.log(`verifying consumer ${consumer} has expected subscriptions`)
        const result = await consumersClient.send(new QueryCommand({
          TableName: consumersTableName,
          IndexName: 'consumer',
          KeyConditionExpression: 'consumer = :c',
          ExpressionAttributeValues: {
            ':c': {
              S: consumer
            },
          },
        }))

        if (result.Items) {
          for (const item of result.Items) {
            const subscriptionId = item.subscription.S
            if (subscriptionId) {
              console.log(`checking ${subscriptionId} to make sure it has the right attributes in the subscription table`)
              const subscriptionGetResult = await subscriptionsClient.send(new GetItemCommand({
                TableName: subscriptionsTableName,
                Key: {
                  subscription: {
                    S: subscriptionId
                  },
                  provider: {
                    S: provider
                  }
                }
              }))
              const subscription = subscriptionGetResult.Item
              if (subscription) {
                if (subscription.provider.S !== provider){
                  throw new Error(`subscription ${subscriptionId} has provider ${provider} in D1 but ${subscription.provider.S} in Dynamo`)
                }
                if (subscription.customer.S !== customer){
                  throw new Error(`subscription ${subscriptionId} has customer ${customer} in D1 but ${subscription.provider.S} in Dynamo`)
                }
              } else {
                throw new Error(`found consumer record with subscription ID ${subscriptionId} in consumers table but could not find it in the subscriptions table`)
              }
            } else {
              throw new Error(`consumer record for ${consumer} at ${provider} has no subscription id`)
            }
          }
        } else {
          throw new Error(`found no items in dynamo for consumer ${consumer}`)
        }
      }

    }
  }
}

/**
 * Convert customer string to a subscription the way we do in upload-api/stores/provisions.js#34
 * 
 * @param {string} customer 
 * @returns string
 */
async function customerToSubscription (customer) {
  /**
   * @type {{customer: string, order?: number}}
   */
  const s = { customer }
  const { cid } = await CBOR.write(s)
  return cid.toString()
}

/**
 * Get Env validating it is set.
 */
function getEnv () {
  return {
    STAGE: mustGetEnv('STAGE'),
    DELEGATIONS_TABLE_NAME: process.env.DELEGATIONS_TABLE_NAME ?? 'delegations',
    SUBSCRIPTIONS_TABLE_NAME: process.env.SUBSCRIPTIONS_TABLE_NAME ?? 'subscriptions',
    CONSUMERS_TABLE_NAME: process.env.CONSUMERS_TABLE_NAME ?? 'consumers',
  }
}

/**
 * @param {string} env
 */
function getRegion (env) {
  if ((env === 'staging') || (env === 'pr194')) {
    return 'us-east-2'
  }

  return 'us-west-2'
}

/**
 * @param {string} tableName
 * @param {string} env
 * @param {string} region
 */
function getDynamoDb (tableName, env, region) {
  const endpoint = `https://dynamodb.${region}.amazonaws.com`

  return {
    client: new DynamoDBClient({
      region,
      endpoint
    }),
    tableName: `${env}-w3infra-${tableName}`,
    endpoint
  }
}

export async function verifyD1DynamoMigration () {
  await verifyInDynamo(await loadFromD1())
  console.log('success! all items from D1 were found in Dynamo')
}