import {
  DynamoDBClient,
  BatchWriteItemCommand
} from '@aws-sdk/client-dynamodb'
import { marshall } from '@aws-sdk/util-dynamodb'
import { CBOR } from '@ucanto/server'
import fs from 'fs/promises'

export async function addToDynamo () {
  const {
    ENV,
    DELEGATIONS_TABLE_NAME,
    CONSUMERS_TABLE_NAME,
    SUBSCRIPTIONS_TABLE_NAME
  } = getEnv()

  const { client: delegationsClient, tableName: delegationsTableName } = getDynamoDb(
    DELEGATIONS_TABLE_NAME,
    ENV,
    getRegion(ENV)
  )
  const { client: subscriptionsClient, tableName: subscriptionsTableName } = getDynamoDb(
    SUBSCRIPTIONS_TABLE_NAME,
    ENV,
    getRegion(ENV)
  )
  const { client: provisionsClient, tableName: provisionsTableName } = getDynamoDb(
    CONSUMERS_TABLE_NAME,
    ENV,
    getRegion(ENV)
  )
  const allDelegations =
    /** @type {{cid: string, audience: string, issuer: string, expiration: number | null, inserted_at: string, updated_at: string}[]} */
    (JSON.parse((await fs.readFile(`d1-migration/data/delegations.json`)).toString()))

  for (const delegations of chunks(allDelegations, 25)) {
    const cmd = new BatchWriteItemCommand({
      RequestItems: {
        [delegationsTableName]: delegations.map(d => ({
          PutRequest: {
            Item: marshall({
              link: d.cid,
              audience: d.audience,
              issuer: d.issuer,
              expiration: d.expiration,
              insertedAt: d.inserted_at,
              updatedAt: d.updated_at
            })
          }
        }))
      }
    })
    console.log(cmd)
    //await delegationsClient.send(cmd)
  }

  const allProvisions =
    /** @type {{cid: string, consumer: string, provider: string, sponsor: string, inserted_at: string, updated_at: string}[]} */
    (JSON.parse((await fs.readFile(`d1-migration/data/provisions.json`)).toString()))

  for (const provisions of chunks(allProvisions, 25)) {
    const subscriptionsCmd = new BatchWriteItemCommand({
      RequestItems: {
        [subscriptionsTableName]: await Promise.all(provisions.map(async p => ({
          PutRequest: {
            Item: marshall({
              provider: p.provider,
              customer: p.sponsor,
              subscription: await customerToSubscription(p.sponsor),
              insertedAt: p.inserted_at,
              updatedAt: p.updated_at
            })
          }
        })))
      }
    })
    
    const provisionsCmd = new BatchWriteItemCommand({
      RequestItems: {
        [provisionsTableName]: await Promise.all(provisions.map(async p => ({
          PutRequest: {
            Item: marshall({
              consumer: p.consumer,
              provider: p.provider,
              subscription: await customerToSubscription(p.sponsor),
              insertedAt: p.inserted_at,
              updatedAt: p.updated_at
            })
          }
        })))
      }
    })
    console.log(subscriptionsCmd)
    console.log(provisionsCmd)
    //await subscriptionsClient.send(subscriptionsCmd)
    //await provisionsClient.send(provisionsCmd)
  }
}

/**
 * Convert customer string to a subscription the way we do in upload-api/stores/provisions.js#34
 * 
 * @param {string} customer 
 * @returns string
 */
async function customerToSubscription (customer) {
  const { cid } = await CBOR.write({ customer })
  return cid.toString()
}

/**
 * Get Env validating it is set.
 */
function getEnv () {
  return {
    ENV: mustGetEnv('ENV'),
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
  if (env === 'staging') {
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