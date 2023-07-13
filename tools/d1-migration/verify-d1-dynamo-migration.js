import {
  DynamoDBClient,
  BatchWriteItemCommand,
  QueryCommand,
  GetItemCommand
} from '@aws-sdk/client-dynamodb'
import { marshall } from '@aws-sdk/util-dynamodb'
import { CBOR } from '@ucanto/server'

import { exec as childProcessExec } from 'child_process'

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

  // console.log('verifying delegations')
  // for (const delegation of allDelegations) {
  //   console.log(`looking for delegation ${delegation.cid}`)
  //   const result = await delegationsClient.send(new GetItemCommand({
  //     TableName: delegationsTableName,
  //     Key: {
  //       link: {
  //         S: delegation.cid
  //       }
  //     }
  //   }))
  //   if (!result.Item) {
  //     throw new Error(`failed to find delegation ${delegation.cid} in Dynamo!`)
  //   }
  // }

  console.log('verifying provisions')
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
}

// a map to de-dupe subscriptions - we need to do this because we didn't previously enforce one-space-per-customer
/**
 * @type Record<string, number>
 */
const subscriptions = {}

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

  // to support existing customers who have created more than one space, we add an extra "ordinality" 
  // field to the CBOR struct we use to generate a subscription ID for all but the first subscription
  // we find for a particular customer
  if (subscriptions[customer]) {
    s.order = subscriptions[customer]
    subscriptions[customer] += 1
  } else {
    subscriptions[customer] = 1
  }
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
 * 
 * @param {string} name 
 * @returns {string}
 */
function mustGetEnv (name) {
  const value = process.env[name]
  if (!value) {
    throw new Error(`Missing env var: ${name}`)
  }

  return value
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

/**
 * @template T
 * @param {Array<T>} arr
 * @param {number} chunkSize 
 * @yields {Array<T>}
 */
function* chunks (arr, chunkSize) {
  for (let i = 0; i < arr.length; i += chunkSize) {
    yield arr.slice(i, i + chunkSize);
  }
}

export async function verifyD1DynamoMigration () {
  await verifyInDynamo(await loadFromD1())
  console.log('success! all items from D1 were found in Dynamo')
}